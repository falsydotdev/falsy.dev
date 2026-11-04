import { describe, expect, it } from 'vitest';
import { type AtmosphereModel, MULTI_SCATTER_SIZE, buildMultiScatter, buildOpticalDepth, sunTransmittance } from '../../src/scene/atmosphere-luts';

const MARS: AtmosphereModel = {
  radiusKm: 3396.19,
  topKm: 110,
  scaleHeightKm: 11,
  extinction: [0.0094, 0.0093, 0.0094],
  scattering: [0.0084, 0.0061, 0.0040],
  groundAlbedo: [0.3, 0.2, 0.13],
};

describe('atmosphere tables', () => {
  const depth = buildOpticalDepth(MARS);

  it('integrates one scale height straight up and about √(πRH/2) along the horizon', () => {
    const up = -Math.log(sunTransmittance(MARS, depth, MARS.radiusKm + 1e-3, 1)[0]) / MARS.extinction[0];
    expect(up).toBeCloseTo(11, 0);
    const flat = -Math.log(sunTransmittance(MARS, depth, MARS.radiusKm + 1e-3, 1e-4)[0]) / MARS.extinction[0];
    expect(flat / Math.sqrt((Math.PI * MARS.radiusKm * 11) / 2)).toBeCloseTo(1, 1);
  });

  it('is dark where the planet blocks the Sun', () => {
    expect(sunTransmittance(MARS, depth, MARS.radiusKm + 5, -0.3)).toEqual([0, 0, 0]);
  });

  it('builds multiple scattering that is brighter in daylight and fades with height', () => {
    const t0 = performance.now();
    const ms = buildMultiScatter(MARS, depth);
    expect(performance.now() - t0).toBeLessThan(500);
    const N = MULTI_SCATTER_SIZE;
    const at = (i: number, j: number) => ms[(j * N + i) * 4];
    expect(at(N - 1, 0)).toBeGreaterThan(at(N / 2, 0));
    expect(at(N - 1, 0)).toBeGreaterThan(at(N - 1, N - 1));
    expect(Number.isFinite(at(0, 0))).toBe(true);
  });
});
