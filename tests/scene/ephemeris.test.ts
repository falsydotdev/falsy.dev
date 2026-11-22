import { describe, expect, it } from 'vitest';
import * as A from 'astronomy-engine';
import * as proto from '../../prototypes/mars-orbit/src/ephemeris.js';
import { bodyState, bodyFrame, localSolarTime, nextSunrise, sunElevationAt, vec } from '../../src/scene/ephemeris';
import { MARS, MOON } from '../../src/scene/bodies';
import type { Body } from '../../src/scene/bodies';

const EARTH = { ae: 'Earth' } as Body;
const angleDeg = (a: readonly number[], b: { x: number; y: number; z: number }) => {
  const n = vec.norm([b.x, b.y, b.z]);
  return Math.acos(Math.min(1, vec.dot(a as [number, number, number], n))) / (Math.PI / 180);
};

const DATES = [new Date('2026-11-02T12:00:00Z'), new Date('2027-03-15T03:30:00Z'), new Date('2028-07-01T18:45:00Z')];

describe('ephemeris port', () => {
  it.each(DATES)('matches the prototype at %s', (date) => {
    const a = bodyState(MARS, date);
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
    const { x, y, z } = bodyFrame(MARS, date);
    expect(vec.len(x)).toBeCloseTo(1, 12);
    expect(vec.len(y)).toBeCloseTo(1, 12);
    expect(vec.dot(x, z)).toBeCloseTo(0, 12);
    vec.cross(x, y).forEach((v, i) => expect(v).toBeCloseTo(z[i], 12));
  });

  it("keeps the Moon's IAU frame", () => {
    // Known-good values from the IAU rotation model.
    const f = bodyFrame(MOON, new Date('2027-03-15T03:30:00Z'));
    const known = {
      x: [-0.15943511325618823, -0.914508063174607, -0.37182717362992107],
      y: [0.9870552117826339, -0.14103583624205573, -0.07636034172424691],
      z: [0.0173911918431762, -0.3791884693449065, 0.9251560144981714],
    };
    for (const axis of ['x', 'y', 'z'] as const) f[axis].forEach((v, i) => expect(v).toBeCloseTo(known[axis][i], 12));
  });

  it('puts noon under the Sun', () => {
    expect(localSolarTime(120, 120)).toBe('12:00');
    expect(localSolarTime(30, 120)).toBe('06:00');
    expect(localSolarTime(300, 120)).toBe('00:00');
  });

  it('finds a sunrise within one sol, at the requested elevation', () => {
    const from = DATES[0];
    const t = nextSunrise(MARS, from, 18.65, 226.2, 6);
    expect(t).not.toBeNull();
    const hours = (t!.getTime() - from.getTime()) / 3.6e6;
    expect(hours).toBeGreaterThan(0);
    expect(hours).toBeLessThan(24.7);
    expect(sunElevationAt(MARS, t!, 18.65, 226.2)).toBeCloseTo(6, 1);
  });
});

describe("Earth's frame", () => {
  // astronomy-engine places surface observers from its own sidereal time, precession, and nutation.
  const surface = (date: Date, latitude: number, longitude: number) =>
    A.ObserverVector(date, new A.Observer(latitude, longitude, 0), false);
  const dates = Array.from({ length: 40 }, (_, i) => new Date(Date.UTC(1995, 0, 1) + i * 517.3 * 86400e3).toISOString());

  it.each(dates)('matches the true pole and Greenwich apparent sidereal time at %s', (iso) => {
    const date = new Date(iso);
    const f = bodyFrame(EARTH, date);
    expect(angleDeg(f.x, surface(date, 0, 0))).toBeLessThan(0.005);
    expect(angleDeg(f.y, surface(date, 0, 90))).toBeLessThan(0.005);
    expect(angleDeg(f.z, surface(date, 90, 0))).toBeLessThan(0.005);
  });
});
