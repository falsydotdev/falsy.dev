// Lookup tables for the atmosphere shader, built once on the CPU (a few tens of ms) so they
// work the same on WebGPU and WebGL2. Follows Hillaire (2020), "A Scalable and Production
// Ready Sky and Atmosphere Rendering Technique": a transmittance table, and a table of light
// scattered more than once, which is what makes a dusty sky glow past the terminator.

export type RGB = readonly [number, number, number];

/** How a component's density falls with height h (km), as a fraction of its peak. */
export type Profile = { scaleHeightKm: number } | { tent: { bottomKm: number; peakKm: number; topKm: number } };

/** One kind of particle in the air, with coefficients per km at its peak density. */
export interface AtmosphereComponent {
  scattering: RGB;
  absorption: RGB;
  profile: Profile;
  // Rayleigh's phase function, or a Henyey-Greenstein g per channel; absent when it only absorbs.
  phase?: 'rayleigh' | RGB;
}

/** A body's atmosphere, as its body config declares it. */
export interface Atmosphere {
  topKm: number; // height of the top of the atmosphere
  groundAlbedo: RGB; // for light the ground bounces back up in the multiple-scattering table
  intensity: number; // the sunlight the scattering shell is lit with
  components: AtmosphereComponent[];
}

export type AtmosphereModel = Atmosphere & { radiusKm: number };

export const OPTICAL_DEPTH_SIZE = { width: 256, height: 64 };
export const MULTI_SCATTER_SIZE = 32;
const MS_DIRECTIONS = 64;
const MS_STEPS = 20;

export function density(p: Profile, h: number) {
  if ('scaleHeightKm' in p) return Math.exp(-h / p.scaleHeightKm);
  const { bottomKm, peakKm, topKm } = p.tent;
  const f = h < peakKm ? (h - bottomKm) / (peakKm - bottomKm) : (topKm - h) / (topKm - peakKm);
  return Math.min(Math.max(f, 0), 1);
}

// Even steps a quarter of the thinnest scale height long on a vertical ray: Mars's 11 km dust
// gets 40, Earth's 1.2 km haze several hundred, so it isn't under-counted by a sixth.
function depthSteps(m: AtmosphereModel) {
  const thinnest = Math.min(...m.components.map((c) => ('scaleHeightKm' in c.profile ? c.profile.scaleHeightKm : Infinity)));
  return Math.max(40, Math.ceil(m.topKm / (thinnest / 4)));
}

const extinctionOf = (c: AtmosphereComponent) => c.scattering.map((s, i) => s + c.absorption[i]);

/** Writes extinction (0–2) and scattering (3–5) per km at height h into `out`. */
function coefficientsAt(m: AtmosphereModel, ext: number[][], h: number, out: Float64Array) {
  out.fill(0);
  m.components.forEach((comp, n) => {
    const rho = density(comp.profile, h);
    for (let c = 0; c < 3; c++) {
      out[c] += ext[n][c] * rho;
      out[c + 3] += comp.scattering[c] * rho;
    }
  });
}

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

/**
 * Optical depth per channel from radius r along cos-zenith μ to the top of the atmosphere, as RGBA
 * with A = 1. Transmittance is exp(−rgb); interpolating depth rather than transmittance keeps
 * grazing rays smooth, and half floats don't underflow at the horizon.
 */
export function buildTransmittance(m: AtmosphereModel) {
  const { width: W, height: Hh } = OPTICAL_DEPTH_SIZE;
  const steps = depthSteps(m);
  const ext = m.components.map(extinctionOf);
  const out = new Float32Array(W * Hh * 4);
  for (let j = 0; j < Hh; j++) {
    for (let i = 0; i < W; i++) {
      const [r, mu] = depthRay(m, i / (W - 1), j / (Hh - 1));
      const dt = distanceToTop(m, r, mu) / steps;
      const column = new Float64Array(m.components.length);
      for (let k = 0; k < steps; k++) {
        const t = (k + 0.5) * dt;
        const h = Math.sqrt(r * r + t * t + 2 * r * mu * t) - m.radiusKm;
        m.components.forEach((c, n) => (column[n] += density(c.profile, h) * dt));
      }
      const o = (j * W + i) * 4;
      for (let ch = 0; ch < 3; ch++) out[o + ch] = ext.reduce((sum, e, n) => sum + e[ch] * column[n], 0);
      out[o + 3] = 1;
    }
  }
  return out;
}

function sampleDepth(m: AtmosphereModel, table: Float32Array, r: number, mu: number): RGB {
  const { width: W, height: Hh } = OPTICAL_DEPTH_SIZE;
  const [u, v] = depthUv(m, r, mu);
  const x = Math.min(Math.max(u, 0), 1) * (W - 1);
  const y = Math.min(Math.max(v, 0), 1) * (Hh - 1);
  const x0 = Math.min(Math.floor(x), W - 2);
  const y0 = Math.min(Math.floor(y), Hh - 2);
  const fx = x - x0;
  const fy = y - y0;
  const at = (a: number, b: number, c: number) => table[(b * W + a) * 4 + c];
  const lerp = (c: number) =>
    (at(x0, y0, c) * (1 - fx) + at(x0 + 1, y0, c) * fx) * (1 - fy) + (at(x0, y0 + 1, c) * (1 - fx) + at(x0 + 1, y0 + 1, c) * fx) * fy;
  return [lerp(0), lerp(1), lerp(2)];
}

/** Sunlight reaching radius r with the Sun at cos-zenith μs, or 0 when the planet blocks it. */
export function sunTransmittance(m: AtmosphereModel, table: Float32Array, r: number, muS: number): RGB {
  if (distanceToGround(m, r, muS) >= 0) return [0, 0, 0];
  const od = sampleDepth(m, table, r, muS);
  return [Math.exp(-od[0]), Math.exp(-od[1]), Math.exp(-od[2])];
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
  const ext = m.components.map(extinctionOf);
  const k6 = new Float64Array(6);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const muS = (i / (N - 1)) * 2 - 1;
      const r0 = m.radiusKm + Math.max((j / (N - 1)) * m.topKm, 0.01);
      const sun = [Math.sqrt(1 - muS * muS), muS, 0];
      const L = [0, 0, 0];
      const f = [0, 0, 0];
      for (const w of dirs) {
        const mu = w[1];
        const ground = distanceToGround(m, r0, mu);
        const d = ground >= 0 ? ground : distanceToTop(m, r0, mu);
        const dt = d / MS_STEPS;
        const thr = [1, 1, 1];
        for (let k = 0; k < MS_STEPS; k++) {
          const t = (k + 0.5) * dt;
          const p = [w[0] * t, r0 + w[1] * t, w[2] * t];
          const r = Math.hypot(p[0], p[1], p[2]);
          coefficientsAt(m, ext, r - m.radiusKm, k6);
          const tSun = sunTransmittance(m, depth, r, (p[0] * sun[0] + p[1] * sun[1]) / r);
          for (let c = 0; c < 3; c++) {
            const se = k6[c];
            const ss = k6[c + 3];
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

/** Both tables, as the shader reads them. They depend only on the atmosphere, not the Sun. */
export function buildTables(m: AtmosphereModel) {
  const transmittance = buildTransmittance(m);
  return { transmittance, multi: buildMultiScatter(m, transmittance) };
}
