import * as THREE from 'three/webgpu';
import {
  Fn, Loop, If, uniform, vec3, vec4, float, positionWorld, cameraPosition,
  normalize, exp, dot, sqrt, max, min, length, pow, smoothstep, clamp, select,
} from 'three/tsl';

// Single scattering raymarched through a shell around the planet (km), with transmittance and
// multiple scattering read from the body's tables (atmosphere-tables.js).
// Light shafts: a grazing sunbeam is checked against the terrain at its lowest point and this
// far either side, where it has climbed only ~3 km on a Mars-sized planet. The soft edge hides
// the coarse map's 10 km cells; a per-pixel dither did that too but left a visible hatch.
const SHAFT_REACH_KM = 150;
// Exaggerated relief tops out near 55 km, so beams that stay higher skip the terrain check.
const SHAFT_CEILING_KM = 60;

const sum = (vs) => vs.reduce((a, b) => a.map((x, i) => x + b[i]));

// TSL density of one profile at height h (km).
function densityAt(profile, h) {
  if ('scaleHeightKm' in profile) return exp(h.negate().div(profile.scaleHeightKm));
  const { bottomKm, peakKm, topKm } = profile.tent;
  return min(h.sub(bottomKm).div(peakKm - bottomKm), float(topKm).sub(h).div(topKm - peakKm)).clamp(0, 1);
}

// TSL twin of viewStepEdge in atmosphere-luts.ts: where step edge x (0 to 1) falls on the ray.
function stepEdge(x, tStart, tLow, tEnd) {
  const before = tLow.sub(tStart);
  const after = tEnd.sub(tLow);
  const split = before.div(max(tEnd.sub(tStart), 1e-6));
  const back = x.lessThan(split).or(after.lessThanEqual(0));
  const side = select(back, split.sub(x).div(max(split, 1e-6)), x.sub(split).div(max(split.oneMinus(), 1e-6)));
  const reach = side.mul(side.add(1)).mul(0.5);
  return select(back, tLow.sub(before.mul(reach)), tLow.add(after.mul(reach)));
}

/**
 * The scattering shell, lit through the body's atmosphere tables.
 * @param {{ tables: Awaited<ReturnType<typeof import('./atmosphere-tables.js').createAtmosphereTables>>, terrainHeight?: (dir: any) => any, viewSteps: number, clouds?: ReturnType<typeof import('./clouds.js').createClouds> | null }} opts
 * `terrainHeight` maps a world-space unit direction to terrain height in km, for light shafts.
 * `viewSteps` is the tier's sample count per view ray; `clouds` puts a cloud shell inside the march.
 */
export function createAtmosphere({ tables, terrainHeight, viewSteps, clouds = null }) {
  const { model, transmittance: sunTransmittance, multiScatter } = tables;
  const u = {
    sunDir: uniform(new THREE.Vector3(1, 0, 0)),
    sunIntensity: uniform(model.intensity),
  };
  const R = model.radiusKm;
  const Ra = R + model.topKm;
  // Components that share a profile share one density evaluation per step.
  const groups = new Map();
  for (const c of model.components) {
    const key = JSON.stringify(c.profile);
    if (!groups.has(key)) groups.set(key, { profile: c.profile, members: [] });
    groups.get(key).members.push(c);
  }

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

  const sampling = model.viewSamples ?? 'even';
  const shade = (steps) => Fn(() => {
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
    const phaseHG = (gRGB) => {
      const g = vec3(...gRGB);
      const g2 = g.mul(g);
      return g2.oneMinus().div(pow(g2.add(1).sub(g.mul(mu).mul(2)), vec3(1.5)).mul(4 * Math.PI));
    };
    // Per group, at unit density: phase-weighted scattering, plain scattering, and extinction.
    const coeffs = [...groups.values()].map(({ profile, members }) => {
      const scatterers = members.filter((c) => c.phase);
      const phased = scatterers.map((c) => vec3(...c.scattering).mul(c.phase === 'rayleigh' ? phaseR : phaseHG(c.phase))).reduce((a, b) => a.add(b), vec3(0));
      return {
        profile,
        phased,
        scatter: vec3(...sum(members.map((c) => c.scattering))),
        extinction: vec3(...sum(members.map((c) => c.scattering.map((x, i) => x + c.absorption[i])))),
      };
    });

    const evenSeg = max(tEnd.sub(tStart), 0).div(steps);
    // The ray's lowest point in the air: where it passes closest to the centre, or the ground.
    const tLow = clamp(b.negate(), tStart, tEnd);
    const throughput = vec3(1).toVar();
    const light = vec3(0).toVar();
    // Cloud light is in the ground's units, so it's kept apart from the shell's scaled light.
    const cloudList = clouds ? clouds.crossings(ro, rd, tEnd, sun) : [];
    const cloudLight = vec3(0).toVar();

    Loop({ start: 0, end: steps, name: 'i' }, ({ i }) => {
      let t = tStart.add(evenSeg.mul(float(i).add(0.5)));
      let seg = evenSeg;
      if (sampling === 'lowest') {
        const t0 = stepEdge(float(i).div(steps), tStart, tLow, tEnd);
        const t1 = stepEdge(float(i).add(1).div(steps), tStart, tLow, tEnd);
        t = t0.add(t1).mul(0.5);
        seg = max(t1.sub(t0), 0);
      }
      if (clouds) clouds.composite(cloudList, t, throughput, cloudLight);
      const p = ro.add(rd.mul(t));
      const r = length(p);
      const h = r.sub(R);
      const muS = dot(p, sun).div(r);
      let phased = vec3(0);
      let scatter = vec3(0);
      let extinction = vec3(0);
      for (const c of coeffs) {
        const dens = densityAt(c.profile, h);
        phased = phased.add(c.phased.mul(dens));
        scatter = scatter.add(c.scatter.mul(dens));
        extinction = extinction.add(c.extinction.mul(dens));
      }

      const direct = vec3(0).toVar();
      const bl = dot(p, sun);
      const shadowDisc = bl.mul(bl).sub(dot(p, p).sub(R * R));
      If(shadowDisc.lessThan(0).or(bl.greaterThan(0)), () => {
        direct.assign(phased.mul(sunTransmittance(r, muS)).mul(shaftLight(p, sun)));
      });
      const source = direct.add(scatter.mul(multiScatter(h, muS)));
      const stepT = exp(extinction.mul(seg).negate());
      light.addAssign(throughput.mul(source).mul(stepT.oneMinus()).div(max(extinction, 1e-7)));
      throughput.mulAssign(stepT);
    });

    if (clouds) clouds.composite(cloudList, tEnd, throughput, cloudLight, true);
    const alpha = throughput.x.add(throughput.y).add(throughput.z).div(3).oneMinus();
    return vec4(clouds ? light.mul(u.sunIntensity).add(cloudLight) : light.mul(u.sunIntensity), alpha);
  });

  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  let steps = viewSteps;
  mat.colorNode = shade(steps)();
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

  // A tier change rebuilds the shader, under the crossfade that covers the change.
  function setSteps(n) {
    if (n === steps) return;
    steps = n;
    mat.colorNode = shade(n)();
    mat.needsUpdate = true;
  }

  return { mesh, uniforms: u, update, setSteps, dispose: () => [mat, mesh.geometry].forEach((x) => x.dispose()) };
}
