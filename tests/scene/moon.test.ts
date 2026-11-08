import { describe, expect, it } from 'vitest';
import * as A from 'astronomy-engine';
import { MOON } from '../../src/scene/bodies';
import { bodyFrame, latLon, sunElevationAt, sunFrom, toBody, vec } from '../../src/scene/ephemeris';
import { circularOrbit, inShadow, orbitalPeriod, orbitalSpeed, sample, stateAt } from '../../src/scene/orbit';
import { chooseShot, dawnDusk, lowSunFeatures, orbitalSunrise, seededRandom } from '../../src/scene/shots';
import { formatTelemetry } from '../../src/scene/telemetry';

const DAY = 86400e3;
const START = new Date('2026-11-08T00:00:00Z');

describe('Moon', () => {
  it('keeps its near side facing Earth, within the libration range', () => {
    for (let d = 0; d < 30; d++) {
      const date = new Date(START.getTime() + d * DAY);
      const g = A.GeoVector(A.Body.Moon, date, true);
      const earth = vec.norm([-g.x, -g.y, -g.z]);
      const sub = latLon(toBody(bodyFrame(MOON, date), earth));
      const lon = sub.lon > 180 ? sub.lon - 360 : sub.lon;
      expect(Math.abs(sub.lat)).toBeLessThan(7.5);
      expect(Math.abs(lon)).toBeLessThan(8.5);
    }
  });

  it('orbits at the speed a 100 km lunar orbit has', () => {
    const o = circularOrbit(MOON, START, MOON.altKm, [1, 0, 0], [0, 1, 0], 0);
    expect(orbitalSpeed(o)).toBeCloseTo(Math.sqrt(4902.8 / 1837.4), 6);
    expect(orbitalPeriod(o) / 60).toBeGreaterThan(117);
    expect(orbitalPeriod(o) / 60).toBeLessThan(119);
    expect(formatTelemetry(sample(o, START), { body: MOON.name, relief: MOON.relief })).toMatch(/^MOON .* ALT 100 km {2}v 1\.63 km\/s {2}relief×2\.5$/);
  });

  it('has a feature under a low Sun on most days of a lunation', () => {
    const days = Array.from({ length: 59 }, (_, i) => new Date(START.getTime() + i * 0.5 * DAY));
    const covered = days.filter((d) => lowSunFeatures(MOON, d).length > 0).length;
    expect(covered / days.length).toBeGreaterThan(0.8);
  });

  it('lights Shackleton only at grazing angles, all year', () => {
    const f = MOON.features.find((x) => x.id === 'shackleton')!;
    const elevations = Array.from({ length: 365 }, (_, i) => sunElevationAt(MOON, new Date(START.getTime() + i * DAY), f.lat, f.lon));
    expect(Math.max(...elevations.map(Math.abs))).toBeLessThan(2.1);
    expect(elevations.some((e) => e >= f.sun!.min && e <= f.sun!.max)).toBe(true);
  });

  it('runs the terminator pass under a low daylight Sun, with the dayside on the right', () => {
    for (let i = 0; i < 10; i++) {
      const now = new Date(START.getTime() + i * 2.9 * DAY);
      const { orbit } = dawnDusk(now, { body: MOON, rand: seededRandom(i) });
      for (const t of [0, 300]) {
        const s = sample(orbit, new Date(now.getTime() + t * 1000));
        const elevation = Math.asin(vec.dot(vec.norm(s.rBody), s.sunBody)) / (Math.PI / 180);
        expect(elevation).toBeGreaterThan(8);
        expect(elevation).toBeLessThan(10.5);
        expect(s.shadow).toBe(false);
      }
    }
  });

  it('starts the sunrise shortly before the Sun clears the limb mountains', () => {
    const now = START;
    const { orbit, keyMoment } = orbitalSunrise(now, { body: MOON, rand: seededRandom(5) });
    expect(keyMoment!.getTime() - now.getTime()).toBe(15e3);
    const limb = MOON.radiusKm + MOON.shots.sunriseLimbKm;
    expect(inShadow(stateAt(orbit, now).r, sunFrom(MOON, now), limb)).toBe(true);
    const after = new Date(keyMoment!.getTime() + 1000);
    expect(inShadow(stateAt(orbit, after).r, sunFrom(MOON, after), limb)).toBe(false);
  });

  it('builds every shot kind at the Moon default altitude', () => {
    for (let i = 0; i < 12; i++) {
      const shot = chooseShot(new Date(START.getTime() + i * 3 * DAY), { body: MOON, rand: seededRandom(i) });
      expect(shot.orbit.body.id).toBe('moon');
      expect(shot.orbit.a).toBeCloseTo(MOON.radiusKm + 100, 6);
    }
  });
});
