import { describe, expect, it } from 'vitest';
import { type AtmosphereModel, density, viewSamples } from '../../src/scene/atmosphere-luts';
import { EARTH, MARS } from '../../src/scene/bodies';
import { TIERS } from '../../src/scene/quality';

const earth: AtmosphereModel = { ...EARTH.atmosphere!, radiusKm: EARTH.radiusKm };

// A view ray from the 400 km orbit, `angle` radians off nadir, in the plane through the planet's
// centre: where it enters the air, its lowest point in the air, where it leaves (or meets the
// ground), and the height above the surface at distance t.
function viewRay(m: AtmosphereModel, angle: number) {
  const R = m.radiusKm;
  const cam = R + EARTH.altKm;
  const rd = [Math.sin(angle), -Math.cos(angle)];
  const b = cam * rd[1];
  const top = R + m.topKm;
  const sq = Math.sqrt(Math.max(b * b - (cam * cam - top * top), 0));
  const tStart = Math.max(-b - sq, 0);
  let tEnd = -b + sq;
  const disc = b * b - (cam * cam - R * R);
  if (disc > 0 && -b - Math.sqrt(disc) > 0) tEnd = Math.min(tEnd, -b - Math.sqrt(disc));
  const tLow = Math.min(Math.max(-b, tStart), tEnd);
  return { tStart, tLow, tEnd, ground: tEnd < -b + sq, heightAt: (t: number) => Math.hypot(rd[0] * t, cam + rd[1] * t) - R };
}

// The shell's single-scattering march (atmosphere.js) without the Sun's angle: light scattered
// toward the camera from unit illumination, and the transmittance to what's behind, per channel.
function march(m: AtmosphereModel, ray: ReturnType<typeof viewRay>, samples: { t: number; seg: number }[]) {
  const throughput = [1, 1, 1];
  const light = [0, 0, 0];
  for (const { t, seg } of samples) {
    const h = ray.heightAt(t);
    for (let c = 0; c < 3; c++) {
      let scatter = 0;
      let extinction = 0;
      for (const comp of m.components) {
        const rho = density(comp.profile, h);
        scatter += comp.scattering[c] * rho;
        extinction += (comp.scattering[c] + comp.absorption[c]) * rho;
      }
      const stepT = Math.exp(-extinction * seg);
      light[c] += (throughput[c] * scatter * (1 - stepT)) / Math.max(extinction, 1e-9);
      throughput[c] *= stepT;
    }
  }
  return { light, throughput };
}

const evenSamples = (tStart: number, tEnd: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({ t: tStart + ((i + 0.5) * (tEnd - tStart)) / n, seg: (tEnd - tStart) / n }));

// Rays a quarter of a High-tier pixel apart (50° lens, 1125 px canvas) from 200 px inside the
// limb out past the top of the air, where the Mie haze and the ozone layer are seen edge-on.
const PX = (50 * Math.PI) / 180 / 1125;
function limbRays(m: AtmosphereModel) {
  const cam = m.radiusKm + EARTH.altKm;
  const top = Math.asin((m.radiusKm + m.topKm) / cam);
  const rays = [];
  for (let a = top - 200 * PX; a < top; a += PX / 4) {
    const ray = viewRay(m, a);
    if (ray.tEnd > ray.tStart) rays.push({ ray, ref: march(m, ray, evenSamples(ray.tStart, ray.tEnd, 4000)) });
  }
  return rays;
}

/**
 * Banding is error that rises and falls across neighbouring pixels. Per channel, in 8-bit levels
 * (of each ray's brightest channel of scattered light, or of a white ground seen through the air),
 * the largest gap between a ray's error and the mean error of the rays within 10 px of it, on the
 * same side of the horizon (the horizon itself is a real edge). `of` picks the light or what the air
 * lets through, which only shows where there's ground behind it.
 */
function ripple(m: AtmosphereModel, steps: number, mode: 'even' | 'lowest', of: 'light' | 'throughput' = 'light') {
  const rays = limbRays(m);
  const errors = rays.map(({ ray, ref }) => {
    const got = march(m, ray, viewSamples(ray.tStart, ray.tLow, ray.tEnd, steps, mode));
    if (of === 'throughput') return got.throughput.map((x, c) => (ray.ground ? (x - ref.throughput[c]) * 255 : 0));
    const peak = Math.max(...ref.light);
    return got.light.map((l, c) => ((l - ref.light[c]) / peak) * 255);
  });
  const W = 40;
  let worst = 0;
  for (let i = W; i < rays.length - W; i++) {
    if (rays[i - W].ray.ground !== rays[i].ray.ground || rays[i + W].ray.ground !== rays[i].ray.ground) continue;
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let j = i - W; j <= i + W; j++) sum += errors[j][c];
      worst = Math.max(worst, Math.abs(errors[i][c] - sum / (2 * W + 1)));
    }
  }
  return worst;
}

describe('viewSamples', () => {
  it('tiles the ray from where it enters the air to where it ends, in order', () => {
    for (const [tLow, mode] of [[300, 'lowest'], [0, 'lowest'], [1000, 'lowest'], [600, 'even']] as const) {
      const s = viewSamples(0, tLow, 1000, 24, mode);
      expect(s).toHaveLength(24);
      expect(s.reduce((a, x) => a + x.seg, 0)).toBeCloseTo(1000, 9);
      expect(s[0].t - s[0].seg / 2).toBeCloseTo(0, 9);
      s.forEach((x, i) => i && expect(x.t - x.seg / 2).toBeCloseTo(s[i - 1].t + s[i - 1].seg / 2, 9));
    }
  });

  it('spaces samples evenly in even mode, as Mars has always drawn', () => {
    expect(viewSamples(100, 700, 1100, 4, 'even')).toEqual(evenSamples(100, 1100, 4));
    expect(MARS.atmosphere!.viewSamples ?? 'even').toBe('even');
  });

  it('packs samples twice as close as even spacing at the lowest point, and spreads them toward the ends', () => {
    const s = viewSamples(0, 400, 1000, 20, 'lowest');
    const even = 1000 / 20;
    const nearest = s.reduce((a, x) => (Math.abs(x.t - 400) < Math.abs(a.t - 400) ? x : a));
    expect(nearest.seg).toBeLessThan(even * 0.6);
    expect(s[0].seg).toBeGreaterThan(even * 1.3);
    expect(s.at(-1)!.seg).toBeGreaterThan(even * 1.3);
  });

  it('draws the haze over the ground closer to the truth than even spacing', () => {
    const nadir = viewRay(earth, 0);
    const ref = march(earth, nadir, evenSamples(nadir.tStart, nadir.tEnd, 4000));
    const err = (s: { t: number; seg: number }[]) => Math.abs(march(earth, nadir, s).light[1] / ref.light[1] - 1);
    const low = TIERS.at(-1)!.atmosphereSteps;
    const packed = err(viewSamples(nadir.tStart, nadir.tLow, nadir.tEnd, low, 'lowest'));
    expect(packed).toBeLessThan(err(evenSamples(nadir.tStart, nadir.tEnd, low)) / 2);
    expect(packed).toBeLessThan(0.05);
  });

  it("leaves no visible bands in Earth's Mie haze or ozone layer on a grazing limb ray at any tier", () => {
    expect(EARTH.atmosphere!.viewSamples).toBe('lowest');
    for (const t of TIERS) {
      expect(ripple(earth, t.atmosphereSteps, 'lowest')).toBeLessThan(1);
      expect(ripple(earth, t.atmosphereSteps, 'lowest', 'throughput')).toBeLessThan(1);
    }
  });
});
