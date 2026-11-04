import { describe, expect, it } from 'vitest';
import * as proto from '../../prototypes/mars-orbit/src/ephemeris.js';
import { marsState, marsFrame, localSolarTime, nextSunrise, sunElevationAt, vec } from '../../src/scene/ephemeris';

const DATES = [new Date('2026-11-02T12:00:00Z'), new Date('2027-03-15T03:30:00Z'), new Date('2028-07-01T18:45:00Z')];

describe('ephemeris port', () => {
  it.each(DATES)('matches the prototype at %s', (date) => {
    const a = marsState(date);
    const b = proto.marsState(date);
    for (const axis of ['x', 'y', 'z'] as const) {
      a.frame[axis].forEach((v, i) => expect(v).toBeCloseTo(b.frame[axis][i], 12));
    }
    a.sun.forEach((v, i) => expect(v).toBeCloseTo(b.sun[i], 12));
    expect(a.subSolarLat).toBeCloseTo(b.subSolarLat, 9);
    expect(a.subSolarLon).toBeCloseTo(b.subSolarLon, 9);
    expect(a.distanceAu).toBeCloseTo(b.distanceAu, 12);
  });

  it.each(DATES)('builds an orthonormal right-handed frame at %s', (date) => {
    const { x, y, z } = marsFrame(date);
    expect(vec.len(x)).toBeCloseTo(1, 12);
    expect(vec.len(y)).toBeCloseTo(1, 12);
    expect(vec.dot(x, z)).toBeCloseTo(0, 12);
    vec.cross(x, y).forEach((v, i) => expect(v).toBeCloseTo(z[i], 12));
  });

  it('puts noon under the Sun', () => {
    expect(localSolarTime(120, 120)).toBe('12:00');
    expect(localSolarTime(30, 120)).toBe('06:00');
    expect(localSolarTime(300, 120)).toBe('00:00');
  });

  it('finds a sunrise within one sol, at the requested elevation', () => {
    const from = DATES[0];
    const t = nextSunrise(from, 18.65, 226.2, 6);
    expect(t).not.toBeNull();
    const hours = (t!.getTime() - from.getTime()) / 3.6e6;
    expect(hours).toBeGreaterThan(0);
    expect(hours).toBeLessThan(24.7);
    expect(sunElevationAt(t!, 18.65, 226.2)).toBeCloseTo(6, 1);
  });
});
