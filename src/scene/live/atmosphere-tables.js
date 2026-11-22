import * as THREE from 'three/webgpu';
import { exp, float, max, sqrt, texture, vec2 } from 'three/tsl';
import { MULTI_SCATTER_SIZE, OPTICAL_DEPTH_SIZE } from '../atmosphere-luts.ts';

function build(model) {
  const worker = new Worker(new URL('./atmosphere-worker.js', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => resolve(data);
    worker.onerror = reject;
    worker.postMessage(model);
  }).finally(() => worker.terminate());
}

function halfFloatTexture(data, width, height) {
  const half = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(data[i]);
  const tex = new THREE.DataTexture(half, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * A body's atmosphere tables (see atmosphere-luts.ts) as GPU textures, with the TSL lookups the
 * scattering shell and the terrain share. Built once per scene, off the main thread.
 * @param {import('../atmosphere-luts.ts').Atmosphere} atmosphere
 * @param {number} radiusKm
 */
export async function createAtmosphereTables(atmosphere, radiusKm) {
  const model = { ...atmosphere, radiusKm };
  const tables = await build(model);
  const depthTex = halfFloatTexture(tables.transmittance, OPTICAL_DEPTH_SIZE.width, OPTICAL_DEPTH_SIZE.height);
  const msTex = halfFloatTexture(tables.multi, MULTI_SCATTER_SIZE, MULTI_SCATTER_SIZE);

  const R = radiusKm;
  const Ra = R + atmosphere.topKm;
  const Hd = Math.sqrt(Ra * Ra - R * R);

  /**
   * RGB sunlight transmittance from radius r (km, from the planet's centre) along cos-zenith μ to
   * the top of the atmosphere. Valid at any height; rays below the horizon read the horizon's value.
   * Bruneton's mapping from atmosphere-luts.ts; ρ² is written as h(2R + h) to keep float precision.
   */
  const transmittance = (r, mu) => {
    const h = r.sub(R);
    const rho = sqrt(max(h.mul(h.add(2 * R)), 0));
    const d = max(r.mul(mu).negate().add(sqrt(max(r.mul(r).mul(mu.mul(mu).sub(1)).add(Ra * Ra), 0))), 0);
    const dMin = float(Ra).sub(r);
    const x = d.sub(dMin).div(max(rho.add(Hd).sub(dMin), 1e-6));
    const { width: W, height: H } = OPTICAL_DEPTH_SIZE;
    const uv = vec2(x.mul(W - 1).add(0.5).div(W), rho.div(Hd).mul(H - 1).add(0.5).div(H));
    return exp(texture(depthTex, uv).level(0).rgb.negate());
  };
  /** Light scattered more than once, per unit sunlight, at height h (km) with the Sun at cos-zenith μs. */
  const multiScatter = (h, muS) => {
    const N = MULTI_SCATTER_SIZE;
    const uv = vec2(muS.mul(0.5).add(0.5).mul(N - 1).add(0.5).div(N), h.div(atmosphere.topKm).clamp(0, 1).mul(N - 1).add(0.5).div(N));
    return texture(msTex, uv).level(0).rgb;
  };

  return { model, transmittance, multiScatter, dispose: () => [depthTex, msTex].forEach((t) => t.dispose()) };
}
