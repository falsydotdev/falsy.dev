import { describe, expect, it } from 'vitest';
import { fromUtm, toUtm } from '../../scripts/tiles/earth/utm.ts';

// WGS84 meridian arc by numerical integration, independent of the series in utm.ts.
function meridianArc(latDeg: number) {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const e2 = f * (2 - f);
  const steps = 20000;
  const phi = (latDeg * Math.PI) / 180;
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const p = ((i + 0.5) / steps) * phi;
    sum += (a * (1 - e2)) / (1 - e2 * Math.sin(p) ** 2) ** 1.5;
  }
  return (sum * phi) / steps;
}

describe('UTM', () => {
  it('puts the zone origin at 500 km east on the equator', () => {
    const p = toUtm(0, 3, 31);
    expect(p.x).toBeCloseTo(500000, 6);
    expect(p.y).toBeCloseTo(0, 6);
  });

  it('measures northing along the central meridian as the scaled meridian arc', () => {
    for (const lat of [10, 45, 72.9]) expect(toUtm(lat, 9, 32).y).toBeCloseTo(0.9996 * meridianArc(lat), 2);
    expect(toUtm(-45, 9, 32, false).y).toBeCloseTo(10000000 - 0.9996 * meridianArc(45), 2);
  });

  it('mirrors east and west of the central meridian', () => {
    const e = toUtm(52, 12, 33);
    const w = toUtm(52, 18, 33);
    expect(e.x + w.x).toBeCloseTo(1000000, 4);
    expect(e.y).toBeCloseTo(w.y, 4);
  });

  it('inverts to within a millimetre-scale angle', () => {
    for (const [lat, lon, zone, north] of [[51.9, 4.4, 31, true], [-33.9, 151.2, 56, false], [83.5, -40, 24, true]] as const) {
      const p = toUtm(lat, lon, zone, north);
      const back = fromUtm(p.x, p.y, zone, north);
      expect(back.lat).toBeCloseTo(lat, 8);
      expect(back.lon).toBeCloseTo(lon, 8);
    }
  });
});
