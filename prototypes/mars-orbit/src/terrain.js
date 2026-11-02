import * as THREE from 'three/webgpu';
import { texture, vec2, vec3, vec4, Fn, If, Loop, Discard, positionWorld, normalize, asin, atan, sin, cos, sqrt, length, dot, max, min, clamp, exp, smoothstep, float, uniform } from 'three/tsl';

const DEG = Math.PI / 180;
export const RADIUS_KM = 3396.19;

// Mars body frame (x: lon 0, y: lon 90E, z: north) -> three.js world (y up).
export const toWorld = (b) => new THREE.Vector3(b[0], b[2], -b[1]);

export async function loadHeightPng(url, offset) {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const { data } = ctx.getImageData(0, 0, bmp.width, bmp.height);
  const km = new Float32Array(bmp.width * bmp.height);
  for (let i = 0; i < km.length; i++) km[i] = ((data[i * 4] << 8) | data[i * 4 + 1]) - offset;
  for (let i = 0; i < km.length; i++) km[i] /= 1000;
  return { width: bmp.width, height: bmp.height, km };
}

export async function loadColor(url) {
  const tex = await new THREE.TextureLoader().loadAsync(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

function sampleBilinear(h, u, v) {
  const x = Math.min(h.width - 1.001, Math.max(0, u * (h.width - 1)));
  const y = Math.min(h.height - 1.001, Math.max(0, v * (h.height - 1)));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const i = y0 * h.width + x0;
  const a = h.km[i] * (1 - fx) + h.km[i + 1] * fx;
  const b = h.km[i + h.width] * (1 - fx) + h.km[i + h.width + 1] * fx;
  return a * (1 - fy) + b * fy;
}

// Object-space normals in three.js world axes, encoded to RGBA8. Gradients are taken on
// the sphere so the map is valid everywhere, poles excepted.
export function buildNormalMap(h, bounds, exaggeration) {
  const { width: w, height: hh, km } = h;
  const data = new Uint8Array(w * hh * 4);
  const dLon = ((bounds.lonMax - bounds.lonMin) / w) * DEG;
  const dLat = ((bounds.latMax - bounds.latMin) / hh) * DEG;
  for (let y = 0; y < hh; y++) {
    const lat = (bounds.latMax - ((y + 0.5) / hh) * (bounds.latMax - bounds.latMin)) * DEG;
    const cl = Math.max(Math.cos(lat), 1e-3);
    const sl = Math.sin(lat);
    const ym = Math.max(0, y - 1) * w;
    const yp = Math.min(hh - 1, y + 1) * w;
    for (let x = 0; x < w; x++) {
      const lon = (bounds.lonMin + ((x + 0.5) / w) * (bounds.lonMax - bounds.lonMin)) * DEG;
      const xm = bounds.wrap ? (x - 1 + w) % w : Math.max(0, x - 1);
      const xp = bounds.wrap ? (x + 1) % w : Math.min(w - 1, x + 1);
      const dhdx = ((km[y * w + xp] - km[y * w + xm]) * exaggeration) / (2 * RADIUS_KM * cl * dLon);
      const dhdy = ((km[ym + x] - km[yp + x]) * exaggeration) / (2 * RADIUS_KM * dLat);
      const cn = Math.cos(lon);
      const sn = Math.sin(lon);
      const up = [cl * cn, cl * sn, sl];
      const east = [-sn, cn, 0];
      const north = [-sl * cn, -sl * sn, cl];
      let n0 = up[0] - dhdx * east[0] - dhdy * north[0];
      let n1 = up[1] - dhdx * east[1] - dhdy * north[1];
      let n2 = up[2] - dhdx * east[2] - dhdy * north[2];
      const len = Math.hypot(n0, n1, n2);
      n0 /= len;
      n1 /= len;
      n2 /= len;
      // DataTextures aren't flipped, so store bottom-up to match the image-based colour maps.
      const o = ((hh - 1 - y) * w + x) * 4;
      data[o] = (n0 * 0.5 + 0.5) * 255;
      data[o + 1] = (n2 * 0.5 + 0.5) * 255;
      data[o + 2] = (-n1 * 0.5 + 0.5) * 255;
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, w, hh, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = bounds.wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

export function buildGeometry(h, bounds, segX, segY, exaggeration) {
  const count = (segX + 1) * (segY + 1);
  const pos = new Float32Array(count * 3);
  const nrm = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  let p = 0;
  for (let j = 0; j <= segY; j++) {
    const v = j / segY;
    const lat = (bounds.latMax - v * (bounds.latMax - bounds.latMin)) * DEG;
    for (let i = 0; i <= segX; i++) {
      const u = i / segX;
      const lon = (bounds.lonMin + u * (bounds.lonMax - bounds.lonMin)) * DEG;
      const r = RADIUS_KM + sampleBilinear(h, u, v) * exaggeration;
      const bx = Math.cos(lat) * Math.cos(lon);
      const by = Math.cos(lat) * Math.sin(lon);
      const bz = Math.sin(lat);
      pos.set([bx * r, bz * r, -by * r], p * 3);
      nrm.set([bx, bz, -by], p * 3);
      uv.set([u, 1 - v], p * 2);
      p++;
    }
  }
  const index = new Uint32Array(segX * segY * 6);
  let k = 0;
  for (let j = 0; j < segY; j++) {
    for (let i = 0; i < segX; i++) {
      const a = j * (segX + 1) + i;
      const b = a + segX + 1;
      index.set([a, b, a + 1, b, b + 1, a + 1], k);
      k += 6;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeBoundingSphere();
  return geo;
}

// Shared lighting inputs for every terrain patch.
export const lighting = {
  sunDir: uniform(new THREE.Vector3(1, 0, 0)),
  sunColor: uniform(new THREE.Color(1, 0.95, 0.88)),
  sunIntensity: uniform(3.4),
  ambient: uniform(0.015),
  exaggeration: uniform(1),
  shadows: uniform(1),
  opticalDepth: uniform(0.35),
};

function buildHeightTexture(h, wrap) {
  const { width: w, height: hh, km } = h;
  const data = new Uint16Array(w * hh);
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) data[(hh - 1 - y) * w + x] = THREE.DataUtils.toHalfFloat(km[y * w + x]);
  const tex = new THREE.DataTexture(data, w, hh, THREE.RedFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

const SHADOW_STEPS = 44;

// A lat/lon terrain patch: displaced mesh, world-space normal map, colour map, and
// sun shadows raymarched through the heightfield (long dawn shadows need real occlusion).
export class TerrainPatch {
  constructor({ height, color, bounds, segX, segY, hole }) {
    this.height = height;
    this.bounds = bounds;
    this.segX = segX;
    this.segY = segY;
    this.normalSlot = texture(new THREE.DataTexture());
    const heightTex = buildHeightTexture(height, bounds.wrap);
    const R = RADIUS_KM;
    const latMin = bounds.latMin * DEG;
    const latSpan = (bounds.latMax - bounds.latMin) * DEG;
    const lonMin = bounds.lonMin * DEG;
    const lonSpan = (bounds.lonMax - bounds.lonMin) * DEG;
    const TAU = Math.PI * 2;

    const sampleHeight = (lat, lon) => {
      // Normalise longitude into this patch's range before converting to uv.
      const l = lon.sub(lonMin).div(TAU).fract().mul(TAU).add(lonMin);
      const uvK = vec2(l.sub(lonMin).div(lonSpan), lat.sub(latMin).div(latSpan));
      return texture(heightTex, uvK).level(0).r.mul(lighting.exaggeration);
    };

    if (hole) {
      this.hole = uniform(new THREE.Vector4(hole.latMin, hole.latMax, hole.lonMin, hole.lonMax));
      this.holeEnabled = uniform(1);
    }

    const mat = new THREE.MeshBasicNodeMaterial();
    mat.colorNode = Fn(() => {
      const n = normalize(positionWorld);
      const lat = asin(n.y);
      const lon = atan(n.z.negate(), n.x);
      if (hole) {
        const latD = lat.mul(1 / DEG);
        const lonD = lon.mul(1 / DEG).add(360).mod(360);
        const inside = latD.greaterThan(this.hole.x).and(latD.lessThan(this.hole.y)).and(lonD.greaterThan(this.hole.z)).and(lonD.lessThan(this.hole.w));
        If(inside.and(this.holeEnabled.greaterThan(0.5)), () => {
          Discard();
        });
      }

      const albedo = texture(color).rgb;
      const N = normalize(this.normalSlot.xyz.mul(2).sub(1));
      const s = lighting.sunDir;
      const ndl = max(dot(N, s), 0);
      const su = dot(n, s);

      const shadow = float(1).toVar();
      If(su.greaterThan(-0.08).and(ndl.greaterThan(0)).and(lighting.shadows.greaterThan(0.5)), () => {
        const east = vec3(sin(lon).negate(), 0, cos(lon).negate());
        const north = vec3(sin(lat).negate().mul(cos(lon)), cos(lat), sin(lat).mul(sin(lon)));
        const se = dot(s, east);
        const sn = dot(s, north);
        const hl = max(sqrt(se.mul(se).add(sn.mul(sn))), 1e-4);
        const tanE = su.div(hl);
        // Start height comes from the same texture the march samples; the mesh is far
        // coarser and would self-shadow along triangle edges.
        const h0 = sampleHeight(lat, lon).add(0.03);
        const cosLat = max(cos(lat), 0.02);
        const d = float(0.4).toVar();
        Loop({ start: 0, end: SHADOW_STEPS, name: 'k' }, () => {
          const latK = lat.add(sn.div(hl).mul(d).div(R));
          const lonK = lon.add(se.div(hl).mul(d).div(cosLat.mul(R)));
          const terrain = sampleHeight(latK, lonK);
          const ray = h0.add(tanE.mul(d)).sub(d.mul(d).div(2 * R));
          const penumbra = d.mul(0.0061).add(0.04);
          shadow.assign(min(shadow, clamp(ray.sub(terrain).div(penumbra).mul(0.5).add(0.5), 0, 1)));
          d.mulAssign(1.17);
        });
      });

      // Sunlight reddens and dims through the dusty atmosphere as the Sun nears the horizon.
      const airmass = float(1).div(max(su.add(0.035), 0.02));
      const trans = exp(vec3(0.85, 1.0, 1.25).mul(lighting.opticalDepth).mul(airmass).negate());
      const direct = albedo.mul(lighting.sunColor).mul(lighting.sunIntensity).mul(ndl).mul(shadow).mul(trans);
      const sky = albedo.mul(vec3(1, 0.72, 0.5)).mul(lighting.ambient).mul(smoothstep(-0.2, 0.25, su));
      return vec4(direct.add(sky), 1);
    })();

    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    this.mesh.frustumCulled = false;
  }

  setExaggeration(exaggeration) {
    lighting.exaggeration.value = exaggeration;
    this.mesh.geometry.dispose();
    this.mesh.geometry = buildGeometry(this.height, this.bounds, this.segX, this.segY, exaggeration);
    const old = this.normalSlot.value;
    this.normalSlot.value = buildNormalMap(this.height, this.bounds, exaggeration);
    old?.dispose();
  }

  heightAt(latDeg, lonDeg) {
    const u = (lonDeg - this.bounds.lonMin) / (this.bounds.lonMax - this.bounds.lonMin);
    const v = (this.bounds.latMax - latDeg) / (this.bounds.latMax - this.bounds.latMin);
    return sampleBilinear(this.height, u, v);
  }
}

