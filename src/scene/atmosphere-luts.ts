// Lookup tables for the atmosphere shader, built once on the CPU (a few tens of ms) so they
// work the same on WebGPU and WebGL2. Follows Hillaire (2020), "A Scalable and Production
// Ready Sky and Atmosphere Rendering Technique": a transmittance table, and a table of light
// scattered more than once, which is what makes a dusty sky glow past the terminator.

export type RGB = [number, number, number];

export interface AtmosphereModel {
  radiusKm: number;
  topKm: number; // height of the top of the atmosphere
  scaleHeightKm: number;
  // Per km at the surface, already scaled by the dust load.
  extinction: RGB;
  scattering: RGB;
  groundAlbedo: RGB;
}

export const OPTICAL_DEPTH_SIZE = { width: 256, height: 64 };
export const MULTI_SCATTER_SIZE = 32;
const DEPTH_STEPS = 40;
const MS_DIRECTIONS = 64;
const MS_STEPS = 20;

/**
 * Bruneton's parameterisation: texel (u, v) ↔ (r, μ) for rays that reach the top of the
 * atmosphere without hitting the ground. It packs texels near the horizon, where depth changes fastest.
 */
export function depthUv(m: AtmosphereModel, r: number, mu: number): [number, number] {
  const Rg = m.radiusKm;
  const Rt = Rg + m.topKm;
  const H = Math.sqrt(Rt * Rt - Rg * Rg);
  const rho = Math.sqrt(Math.max(r * r - Rg * Rg, 0));
  const d = Math.max(-r * mu + Math.sqrt(Math.max(r * r * (mu * mu - 1) + Rt * Rt, 0)), 0);
  const dMin = Rt - r;
  const dMax = rho + H;
  return [(d - dMin) / Math.max(dMax - dMin, 1e-9), rho / H];
}

function depthRay(m: AtmosphereModel, u: number, v: number): [number, number] {
  const Rg = m.radiusKm;
  const Rt = Rg + m.topKm;
  const H = Math.sqrt(Rt * Rt - Rg * Rg);
  const rho = H * v;
  const r = Math.sqrt(rho * rho + Rg * Rg);
  const dMin = Rt - r;
  const d = dMin + u * (rho + H - dMin);
  const mu = d === 0 ? 1 : (H * H - rho * rho - d * d) / (2 * r * d);
  return [r, Math.max(-1, Math.min(1, mu))];
}

const distanceToTop = (m: AtmosphereModel, r: number, mu: number) => {
  const Rt = m.radiusKm + m.topKm;
  return Math.max(-r * mu + Math.sqrt(Math.max(r * r * (mu * mu - 1) + Rt * Rt, 0)), 0);
};

// Distance to the ground along (r, μ), or -1 when the ray misses it.
const distanceToGround = (m: AtmosphereModel, r: number, mu: number) => {
  const disc = r * r * (mu * mu - 1) + m.radiusKm * m.radiusKm;
  if (disc < 0 || mu > 0) return -1;
  return -r * mu - Math.sqrt(disc);
};

/** Column density ∫exp(−h/H) dt (km) from radius r along cos-zenith μ to the top of the atmosphere. */
export function buildOpticalDepth(m: AtmosphereModel) {
  const { width: W, height: Hh } = OPTICAL_DEPTH_SIZE;
  const out = new Float32Array(W * Hh);
  for (let j = 0; j < Hh; j++) {
    for (let i = 0; i < W; i++) {
      const [r, mu] = depthRay(m, i / (W - 1), j / (Hh - 1));
      const d = distanceToTop(m, r, mu);
      const dt = d / DEPTH_STEPS;
      let sum = 0;
      for (let k = 0; k < DEPTH_STEPS; k++) {
        const t = (k + 0.5) * dt;
        const h = Math.sqrt(r * r + t * t + 2 * r * mu * t) - m.radiusKm;
        sum += Math.exp(-h / m.scaleHeightKm) * dt;
      }
      out[j * W + i] = sum;
    }
  }
  return out;
}

function sampleDepth(m: AtmosphereModel, table: Float32Array, r: number, mu: number) {
  const { width: W, height: Hh } = OPTICAL_DEPTH_SIZE;
  const [u, v] = depthUv(m, r, mu);
  const x = Math.min(Math.max(u, 0), 1) * (W - 1);
  const y = Math.min(Math.max(v, 0), 1) * (Hh - 1);
  const x0 = Math.min(Math.floor(x), W - 2);
  const y0 = Math.min(Math.floor(y), Hh - 2);
  const fx = x - x0;
  const fy = y - y0;
  const at = (a: number, b: number) => table[b * W + a];
  return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
}

/** Sunlight reaching radius r with the Sun at cos-zenith μs, or 0 when the planet blocks it. */
export function sunTransmittance(m: AtmosphereModel, table: Float32Array, r: number, muS: number): RGB {
  if (distanceToGround(m, r, muS) >= 0) return [0, 0, 0];
  const od = sampleDepth(m, table, r, muS);
  return [Math.exp(-m.extinction[0] * od), Math.exp(-m.extinction[1] * od), Math.exp(-m.extinction[2] * od)];
}

/**
 * Light scattered two or more times, per unit sunlight, at altitude (v) and Sun cos-zenith (u),
 * as RGBA with A = 1. Second-order light from every direction around the point is summed with an
 * isotropic phase, then the higher orders follow as a geometric series, 1 / (1 − f).
 */
export function buildMultiScatter(m: AtmosphereModel, depth: Float32Array) {
  const N = MULTI_SCATTER_SIZE;
  const out = new Float32Array(N * N * 4);
  const dirs = Array.from({ length: MS_DIRECTIONS }, (_, i) => {
    const y = 1 - (2 * (i + 0.5)) / MS_DIRECTIONS;
    const a = i * Math.PI * (3 - Math.sqrt(5));
    const s = Math.sqrt(1 - y * y);
    return [s * Math.cos(a), y, s * Math.sin(a)] as const;
  });
  const isotropic = 1 / (4 * Math.PI);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const muS = (i / (N - 1)) * 2 - 1;
      const r0 = m.radiusKm + Math.max((j / (N - 1)) * m.topKm, 0.01);
      const sun = [Math.sqrt(1 - muS * muS), muS, 0];
      const L: RGB = [0, 0, 0];
      const f: RGB = [0, 0, 0];
      for (const w of dirs) {
        const mu = w[1];
        const ground = distanceToGround(m, r0, mu);
        const d = ground >= 0 ? ground : distanceToTop(m, r0, mu);
        const dt = d / MS_STEPS;
        const thr: RGB = [1, 1, 1];
        for (let k = 0; k < MS_STEPS; k++) {
          const t = (k + 0.5) * dt;
          const p = [w[0] * t, r0 + w[1] * t, w[2] * t];
          const r = Math.hypot(p[0], p[1], p[2]);
          const density = Math.exp(-(r - m.radiusKm) / m.scaleHeightKm);
          const tSun = sunTransmittance(m, depth, r, (p[0] * sun[0] + p[1] * sun[1]) / r);
          for (let c = 0; c < 3; c++) {
            const se = m.extinction[c] * density;
            const ss = m.scattering[c] * density;
            const stepT = Math.exp(-se * dt);
            const integral = se > 0 ? (1 - stepT) / se : dt;
            L[c] += thr[c] * ss * tSun[c] * isotropic * integral;
            f[c] += thr[c] * ss * integral;
            thr[c] *= stepT;
          }
        }
        if (ground >= 0) {
          const g = [w[0] * ground, r0 + w[1] * ground, w[2] * ground];
          const rg = Math.hypot(g[0], g[1], g[2]);
          const ndl = Math.max((g[0] * sun[0] + g[1] * sun[1]) / rg, 0);
          const tSun = sunTransmittance(m, depth, rg + 1e-3, ndl);
          for (let c = 0; c < 3; c++) L[c] += thr[c] * tSun[c] * ndl * (m.groundAlbedo[c] / Math.PI);
        }
      }
      const o = (j * N + i) * 4;
      for (let c = 0; c < 3; c++) {
        const l2 = L[c] / MS_DIRECTIONS;
        const fms = f[c] / MS_DIRECTIONS;
        out[o + c] = l2 / (1 - fms);
      }
      out[o + 3] = 1;
    }
  }
  return out;
}
