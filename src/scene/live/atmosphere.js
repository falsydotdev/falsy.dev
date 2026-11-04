import * as THREE from 'three/webgpu';
import {
  Fn, Loop, If, uniform, texture, vec2, vec3, vec4, float, positionWorld, cameraPosition,
  normalize, exp, dot, sqrt, max, min, length, pow, smoothstep,
} from 'three/tsl';
import { MULTI_SCATTER_SIZE, OPTICAL_DEPTH_SIZE } from '../atmosphere-luts.ts';

// Single scattering raymarched through a shell around the planet (units: km), with sunlight
// transmittance and multiple scattering read from tables (see atmosphere-luts.ts). Mars is
// dust-dominated: Mie scattering with a per-channel phase asymmetry scatters blue light more
// tightly around the Sun, which gives the blue Martian sunset.
const VIEW_STEPS = 24;
const SCALE_HEIGHT_KM = 11;
const TOP_KM = SCALE_HEIGHT_KM * 10;
const RAYLEIGH = [1.45e-4, 3.4e-4, 8.3e-4];
const MIE_SCATTER = [0.042, 0.03, 0.019];
const MIE_EXTINCTION = [0.046, 0.046, 0.046];
const MIE_G = [0.62, 0.7, 0.82];
// Dusty ground under the multiple-scattering table.
const GROUND_ALBEDO = [0.3, 0.2, 0.13];
// Light shafts: a grazing sunbeam is checked against the terrain at its lowest point and this
// far either side, where it has climbed only ~3 km on a Mars-sized planet. The soft edge hides
// the coarse map's 10 km cells; a per-pixel dither did that too but left a visible hatch.
const SHAFT_REACH_KM = 150;
// Exaggerated relief tops out near 55 km, so beams that stay higher skip the terrain check.
const SHAFT_CEILING_KM = 60;

async function buildTables(model) {
  const worker = new Worker(new URL('./atmosphere-worker.js', import.meta.url), { type: 'module' });
  try {
    return await new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => resolve(data);
      worker.onerror = reject;
      worker.postMessage(model);
    });
  } finally {
    worker.terminate();
  }
}

function halfFloatTexture(data, width, height, format) {
  const half = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(data[i]);
  const tex = new THREE.DataTexture(half, width, height, format, THREE.HalfFloatType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * @param {{ planetRadius: number, density: number, terrainHeight?: (dir: any) => any }} opts
 * `terrainHeight` maps a world-space unit direction to terrain height in km, for light shafts.
 */
export async function createAtmosphere({ planetRadius, density, terrainHeight }) {
  const u = {
    sunDir: uniform(new THREE.Vector3(1, 0, 0)),
    sunIntensity: uniform(16),
  };
  const add = (a, b) => a.map((x, i) => (x + b[i]) * density);
  const model = {
    radiusKm: planetRadius,
    topKm: TOP_KM,
    scaleHeightKm: SCALE_HEIGHT_KM,
    extinction: add(RAYLEIGH, MIE_EXTINCTION),
    scattering: add(RAYLEIGH, MIE_SCATTER),
    groundAlbedo: GROUND_ALBEDO,
  };
  const tables = await buildTables(model);
  const depthTex = halfFloatTexture(tables.depth, OPTICAL_DEPTH_SIZE.width, OPTICAL_DEPTH_SIZE.height, THREE.RedFormat);
  const msTex = halfFloatTexture(tables.multi, MULTI_SCATTER_SIZE, MULTI_SCATTER_SIZE, THREE.RGBAFormat);

  const R = planetRadius;
  const Ra = R + TOP_KM;
  const Hd = Math.sqrt(Ra * Ra - R * R);
  const extinction = vec3(...model.extinction);
  const rayleigh = vec3(...RAYLEIGH).mul(density);
  const mie = vec3(...MIE_SCATTER).mul(density);

  // Bruneton's mapping from atmosphere-luts.ts; ρ² is written as h(2R + h) to keep float precision.
  const sunTransmittance = (r, mu) => {
    const h = r.sub(R);
    const rho = sqrt(max(h.mul(h.add(2 * R)), 0));
    const d = max(r.mul(mu).negate().add(sqrt(max(r.mul(r).mul(mu.mul(mu).sub(1)).add(Ra * Ra), 0))), 0);
    const dMin = float(Ra).sub(r);
    const x = d.sub(dMin).div(max(rho.add(Hd).sub(dMin), 1e-6));
    const { width: W, height: H } = OPTICAL_DEPTH_SIZE;
    const uv = vec2(x.mul(W - 1).add(0.5).div(W), rho.div(Hd).mul(H - 1).add(0.5).div(H));
    return exp(extinction.mul(texture(depthTex, uv).level(0).r).negate());
  };
  const multiScatter = (h, muS) => {
    const N = MULTI_SCATTER_SIZE;
    const uv = vec2(muS.mul(0.5).add(0.5).mul(N - 1).add(0.5).div(N), h.div(TOP_KM).clamp(0, 1).mul(N - 1).add(0.5).div(N));
    return texture(msTex, uv).level(0).rgb;
  };
  // 0 where the terrain blocks the sunbeam through p, 1 where it's clear. The beam is lowest
  // where it passes closest to the planet's centre, or at p itself if it's already climbing.
  const shaftLight = (p, sun) => {
    const lit = float(1).toVar();
    if (!terrainHeight) return lit;
    const tLow = max(dot(p, sun).negate(), 0);
    const low = p.add(sun.mul(tLow));
    If(length(low).lessThan(R + SHAFT_CEILING_KM), () => {
      for (const k of [-1, 0, 1]) {
        const q = p.add(sun.mul(max(tLow.add(k * SHAFT_REACH_KM), 0)));
        const r = length(q);
        const clearance = r.sub(R).sub(terrainHeight(q.div(r)));
        lit.assign(min(lit, smoothstep(-4, 4, clearance)));
      }
    });
    return lit;
  };

  const shade = Fn(() => {
    const ro = cameraPosition;
    const rd = normalize(positionWorld.sub(cameraPosition));

    const b = dot(ro, rd);
    const c = dot(ro, ro).sub(Ra * Ra);
    const sq = sqrt(max(b.mul(b).sub(c), 0));
    const tStart = max(b.negate().sub(sq), 0);
    const tEnd = b.negate().add(sq).toVar();
    // End at the terrain, not the bare sphere, so no haze is gathered from inside mountains: find
    // where the ray meets the sphere, then re-intersect at the terrain height there.
    const discP = b.mul(b).sub(dot(ro, ro).sub(R * R));
    If(discP.greaterThan(0), () => {
      const tp = b.negate().sub(sqrt(discP));
      If(tp.greaterThan(0), () => {
        const hit = ro.add(rd.mul(tp));
        const rg = terrainHeight ? max(terrainHeight(hit.div(R)), 0).add(R) : float(R);
        const tg = b.negate().sub(sqrt(max(b.mul(b).sub(dot(ro, ro).sub(rg.mul(rg))), 0)));
        tEnd.assign(min(tEnd, tg));
      });
    });

    const sun = u.sunDir;
    const mu = dot(rd, sun);
    const phaseR = mu.mul(mu).add(1).mul(3 / (16 * Math.PI));
    const g = vec3(...MIE_G);
    const g2 = g.mul(g);
    const phaseM = g2.oneMinus().div(pow(g2.add(1).sub(g.mul(mu).mul(2)), vec3(1.5)).mul(4 * Math.PI));
    const phased = rayleigh.mul(phaseR).add(mie.mul(phaseM));
    const scatter = rayleigh.add(mie);

    const seg = max(tEnd.sub(tStart), 0).div(VIEW_STEPS);
    const throughput = vec3(1).toVar();
    const light = vec3(0).toVar();

    Loop({ start: 0, end: VIEW_STEPS, name: 'i' }, ({ i }) => {
      const t = tStart.add(seg.mul(float(i).add(0.5)));
      const p = ro.add(rd.mul(t));
      const r = length(p);
      const h = r.sub(R);
      const dens = exp(h.negate().div(SCALE_HEIGHT_KM));
      const muS = dot(p, sun).div(r);

      const direct = vec3(0).toVar();
      const bl = dot(p, sun);
      const shadowDisc = bl.mul(bl).sub(dot(p, p).sub(R * R));
      If(shadowDisc.lessThan(0).or(bl.greaterThan(0)), () => {
        direct.assign(phased.mul(sunTransmittance(r, muS)).mul(shaftLight(p, sun)));
      });
      const source = direct.add(scatter.mul(multiScatter(h, muS))).mul(dens);
      const stepT = exp(extinction.mul(dens).mul(seg).negate());
      light.addAssign(throughput.mul(source).mul(stepT.oneMinus()).div(max(extinction.mul(dens), 1e-7)));
      throughput.mulAssign(stepT);
    });

    const alpha = throughput.x.add(throughput.y).add(throughput.z).div(3).oneMinus();
    return vec4(light.mul(u.sunIntensity), alpha);
  });

  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  mat.colorNode = shade();
  mat.blending = THREE.CustomBlending;
  mat.blendSrc = THREE.OneFactor;
  mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  mat.blendSrcAlpha = THREE.OneFactor;
  mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 256, 128), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  mesh.scale.setScalar(Ra);

  function update(camera) {
    const inside = camera.position.length() < Ra;
    mat.side = inside ? THREE.BackSide : THREE.FrontSide;
    mat.depthTest = !inside;
  }

  return { mesh, uniforms: u, update, dispose: () => [depthTex, msTex, mat, mesh.geometry].forEach((x) => x.dispose()) };
}
