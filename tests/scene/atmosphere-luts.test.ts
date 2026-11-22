import { describe, expect, it } from 'vitest';
import {
  type AtmosphereComponent, type AtmosphereModel, MULTI_SCATTER_SIZE, buildMultiScatter, buildTables, buildTransmittance, sunTransmittance,
} from '../../src/scene/atmosphere-luts';

const MARS: AtmosphereModel = {
  radiusKm: 3396.19,
  topKm: 110,
  groundAlbedo: [0.3, 0.2, 0.13],
  intensity: 16,
  components: [
    { scattering: [0.0084, 0.0061, 0.004], absorption: [0.001, 0.0032, 0.0054], profile: { scaleHeightKm: 11 }, phase: [0.62, 0.7, 0.82] },
  ],
};

// Hillaire (2020), table 1, on the 6371 km sphere Earth is drawn with.
const RAYLEIGH: AtmosphereComponent = { scattering: [5.802e-3, 13.558e-3, 33.1e-3], absorption: [0, 0, 0], profile: { scaleHeightKm: 8 }, phase: 'rayleigh' };
const MIE: AtmosphereComponent = { scattering: [3.996e-3, 3.996e-3, 3.996e-3], absorption: [0.444e-3, 0.444e-3, 0.444e-3], profile: { scaleHeightKm: 1.2 }, phase: [0.8, 0.8, 0.8] };
const OZONE: AtmosphereComponent = { scattering: [0, 0, 0], absorption: [0.65e-3, 1.881e-3, 0.085e-3], profile: { tent: { bottomKm: 10, peakKm: 25, topKm: 40 } } };
const EARTH: AtmosphereModel = { radiusKm: 6371, topKm: 100, groundAlbedo: [0.3, 0.3, 0.3], intensity: 16, components: [RAYLEIGH, MIE, OZONE] };

const opticalDepth = (m: AtmosphereModel, r: number, mu: number) => {
  const t = sunTransmittance(m, buildTransmittance(m), r, mu);
  return t.map((x) => -Math.log(x));
};
const zenith = (m: AtmosphereModel) => opticalDepth(m, m.radiusKm, 1);
const only = (c: AtmosphereComponent): AtmosphereModel => ({ ...EARTH, components: [c] });
const expectClose = (actual: number[], expected: number[], rel: number) =>
  actual.forEach((x, i) => expect(Math.abs(x - expected[i])).toBeLessThanOrEqual(expected[i] * rel + 1e-9));

describe("Earth's atmosphere tables", () => {
  it('give each component its zenith optical depth: scale height × extinction, or the ozone tent’s area', () => {
    expectClose(zenith(only(RAYLEIGH)), [5.802e-3 * 8, 13.558e-3 * 8, 33.1e-3 * 8], 0.01);
    expectClose(zenith(only(MIE)), [4.44e-3 * 1.2, 4.44e-3 * 1.2, 4.44e-3 * 1.2], 0.01);
    expectClose(zenith(only(OZONE)), [0.65e-3 * 15, 1.881e-3 * 15, 0.085e-3 * 15], 0.01);
  });

  it('sum the components along a ray', () => {
    const parts = [RAYLEIGH, MIE, OZONE].map((c) => opticalDepth(only(c), EARTH.radiusKm + 2, 0.3));
    expectClose(opticalDepth(EARTH, EARTH.radiusKm + 2, 0.3), [0, 1, 2].map((ch) => parts.reduce((s, p) => s + p[ch], 0)), 0.005);
  });

  // They're built in a worker at every scene start, so this bounds the wait before the planet shows.
  // About 0.25 s on an M-series Mac; the bound leaves room for a shared CI runner.
  it('build both tables in under two seconds', () => {
    const t0 = performance.now();
    const { transmittance, multi } = buildTables(EARTH);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(transmittance.every(Number.isFinite) && multi.every(Number.isFinite)).toBe(true);
  });
});

describe('Mars atmosphere tables', () => {
  const depth = buildTransmittance(MARS);
  const ext = 0.0094;

  it('integrates one scale height straight up and about √(πRH/2) along the horizon', () => {
    const up = -Math.log(sunTransmittance(MARS, depth, MARS.radiusKm + 1e-3, 1)[0]) / ext;
    expect(up).toBeCloseTo(11, 0);
    const flat = -Math.log(sunTransmittance(MARS, depth, MARS.radiusKm + 1e-3, 1e-4)[0]) / ext;
    expect(flat / Math.sqrt((Math.PI * MARS.radiusKm * 11) / 2)).toBeCloseTo(1, 1);
  });

  it('is dark where the planet blocks the Sun', () => {
    expect(sunTransmittance(MARS, depth, MARS.radiusKm + 5, -0.3)).toEqual([0, 0, 0]);
  });

  it('builds multiple scattering that is brighter in daylight and fades with height', () => {
    const t0 = performance.now();
    const ms = buildMultiScatter(MARS, depth);
    expect(performance.now() - t0).toBeLessThan(5000);
    const N = MULTI_SCATTER_SIZE;
    const at = (i: number, j: number) => ms[(j * N + i) * 4];
    expect(at(N - 1, 0)).toBeGreaterThan(at(N / 2, 0));
    expect(at(N - 1, 0)).toBeGreaterThan(at(N - 1, N - 1));
    expect(Number.isFinite(at(0, 0))).toBe(true);
  });
});
