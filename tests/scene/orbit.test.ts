import { describe, expect, it } from 'vitest';
import { vec } from '../../src/scene/ephemeris';
import { circularOrbit, orbitalPeriod, orbitalSpeed, sample, stateAt } from '../../src/scene/orbit';
import { MARS } from '../../src/scene/bodies';
import { formatTelemetry } from '../../src/scene/telemetry';

const EPOCH = new Date('2026-11-02T12:00:00Z');
const MARS_SIDEREAL_DAY_S = 88642.66;
const orbit = circularOrbit(MARS, EPOCH, 380, [1, 0, 0], [0, 0.6, 0.8], 0.3);
const at = (s: number) => new Date(EPOCH.getTime() + s * 1000);

describe('circular orbit at 380 km', () => {
  it('has the two-body speed and period', () => {
    expect(orbitalSpeed(orbit)).toBeCloseTo(Math.sqrt(MARS.gm / (MARS.radiusKm + 380)), 12);
    expect(orbitalSpeed(orbit)).toBeCloseTo(3.37, 2);
    expect(orbitalPeriod(orbit) / 3600).toBeCloseTo(1.957, 2);
  });

  it('keeps radius, speed, and perpendicular velocity over a full period', () => {
    const T = orbitalPeriod(orbit);
    for (let s = 0; s <= T; s += T / 97) {
      const { r, v } = stateAt(orbit, at(s));
      expect(vec.len(r)).toBeCloseTo(orbit.a, 9);
      expect(vec.len(v)).toBeCloseTo(orbitalSpeed(orbit), 12);
      expect(vec.dot(r, v)).toBeCloseTo(0, 6);
    }
  });

  it('returns to the same inertial position after one period', () => {
    const r0 = stateAt(orbit, at(0)).r;
    const r1 = stateAt(orbit, at(orbitalPeriod(orbit))).r;
    // Date rounds to whole milliseconds, about 3.4 m of travel.
    expect(vec.len(vec.sub(r0, r1))).toBeLessThan(0.005);
  });

  it('moves its ground track west by Mars rotation each orbit', () => {
    const T = orbitalPeriod(orbit);
    const a = sample(orbit, at(0));
    const b = sample(orbit, at(T));
    const shift = ((b.lon - a.lon + 540) % 360) - 180;
    expect(b.lat).toBeCloseTo(a.lat, 1);
    expect(shift).toBeCloseTo((-360 * T) / MARS_SIDEREAL_DAY_S, 1);
  });

  it('reports altitude and speed in the telemetry line', () => {
    const line = formatTelemetry(sample(orbit, at(0)), { body: 'Mars', relief: 2.5 });
    expect(line).toMatch(/^MARS {2}\d+\.\d°[NS] {2}\d+\.\d°E {2}LST \d\d:\d\d {2}ALT 380 km {2}v 3\.37 km\/s {2}relief×2\.5$/);
  });
});
