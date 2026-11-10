import { describe, expect, it } from 'vitest';
import * as A from 'astronomy-engine';
import { MOON } from '../../src/scene/bodies';
import { bodyFrame, earthFromMoon, earthLitFraction, latLon, sunFrom, toBody, vec } from '../../src/scene/ephemeris';
import { circularOrbit, inShadow, orbitalPeriod, orbitalSpeed, sample, stateAt } from '../../src/scene/orbit';
import { cameraRight, chooseShot, dawnDusk, earthrise, featureFlyover, flyoverFeatures, orbitalSunrise, seededRandom, sunAhead, wantsReshoot } from '../../src/scene/shots';
import { MARS } from '../../src/scene/bodies';
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

  // The rest of the time a flyover falls back to the terminator pass.
  it('has a flyover with lit ground under the camera on over half the days of a lunation', () => {
    const days = Array.from({ length: 59 }, (_, i) => new Date(START.getTime() + i * 0.5 * DAY));
    const covered = days.filter((d) => flyoverFeatures(MOON, d).length > 0).length;
    expect(covered / days.length).toBeGreaterThan(0.55);
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

  it('never picks a sunrise, and builds every shot at the Moon default altitude', () => {
    for (let i = 0; i < 40; i++) {
      const shot = chooseShot(new Date(START.getTime() + i * 0.7 * DAY), { body: MOON, rand: seededRandom(i) });
      expect(shot.kind).not.toBe('orbital-sunrise');
      expect(shot.orbit.body.id).toBe('moon');
      expect(shot.orbit.a).toBeCloseTo(MOON.radiusKm + 100, 6);
    }
  });
});

describe('re-shooting once the view goes dark', () => {
  const at = (from: Date, s: number) => new Date(from.getTime() + s * 1000);
  const firstWanted = (shot: ReturnType<typeof chooseShot>, built: Date, untilS: number) => {
    for (let t = 0; t <= untilS; t += 30) if (wantsReshoot(shot, built, at(built, t))) return t;
    return null;
  };

  it('lets the Moon terminator pass run lit, then replaces it before the night side', () => {
    for (let i = 0; i < 10; i++) {
      const built = at(START, i * 2.9 * 86400);
      const shot = dawnDusk(built, { body: MOON, rand: seededRandom(i) });
      const t = firstWanted(shot, built, 7200)!;
      expect(t).toBeGreaterThanOrEqual(600);
      expect(t).toBeLessThan(45 * 60);
    }
  });

  it('replaces a Moon flyover only after the pass', () => {
    for (let i = 0; i < 20; i++) {
      const built = at(START, i * 1.3 * 86400);
      const shot = featureFlyover(built, { body: MOON, rand: seededRandom(i) });
      if (!shot) continue;
      const t = firstWanted(shot, built, 7200);
      if (t !== null) expect(at(built, t).getTime()).toBeGreaterThanOrEqual(shot.keyMoment!.getTime() + 120e3);
    }
  });

  it('never replaces the Mars terminator pass, which its haze keeps lit', () => {
    for (let i = 0; i < 5; i++) {
      const built = at(START, i * 40 * 86400);
      expect(firstWanted(dawnDusk(built, { body: MARS, rand: seededRandom(i) }), built, 3 * 3600)).toBeNull();
    }
  });

  it('plays the Mars sunrise out, and replaces it once the orbit reaches night', () => {
    const shot = orbitalSunrise(START, { body: MARS, rand: seededRandom(5) });
    const t = firstWanted(shot, START, 3 * 3600)!;
    expect(t).toBeGreaterThan(30 * 60);
    expect(t).toBeLessThan(90 * 60);
  });
});

describe('Earthrise', () => {
  const halfDays = Array.from({ length: 59 }, (_, i) => new Date(START.getTime() + i * 0.5 * DAY));

  it('brings Earth over the limb mountains at the key moment, right of the track, with the Sun on the right', () => {
    for (const [i, now] of halfDays.entries()) {
      const shot = earthrise(now, { body: MOON, rand: seededRandom(i), rightDeg: 12 });
      if (!shot) continue;
      const k = shot.keyMoment!;
      expect(k.getTime() - now.getTime()).toBe(20e3);
      const { r, v } = stateAt(shot.orbit, k);
      const toEarth = vec.norm(vec.sub(earthFromMoon(k), r));
      const elevation = Math.asin(vec.dot(toEarth, vec.norm(r))) / (Math.PI / 180);
      const bareHorizon = -Math.acos(MOON.radiusKm / vec.len(r)) / (Math.PI / 180);
      expect(elevation - bareHorizon).toBeGreaterThan(1);
      expect(elevation - bareHorizon).toBeLessThan(1.5);
      expect(Math.asin(vec.dot(toEarth, cameraRight(r, v))) / (Math.PI / 180)).toBeCloseTo(12, 0);
      expect(vec.dot(sunFrom(MOON, k), cameraRight(r, v))).toBeGreaterThan(0);
      expect(sunAhead(shot.orbit, k)).toBeGreaterThanOrEqual(8);
      expect(earthLitFraction(k, sunFrom(MOON, k))).toBeGreaterThanOrEqual(1 / 3);
    }
  });

  it('is available on about half the days of a lunation, and never when Earth is mostly dark', () => {
    const shots = halfDays.map((d, i) => [d, earthrise(d, { body: MOON, rand: seededRandom(i) })] as const);
    expect(shots.filter(([, s]) => s).length / shots.length).toBeGreaterThan(0.5);
    for (const [d, s] of shots) if (earthLitFraction(d, sunFrom(MOON, d)) < 0.3) expect(s).toBeNull();
  });

  it('keeps the ground lit for at least four minutes after load', () => {
    for (const [i, now] of halfDays.entries()) {
      const shot = earthrise(now, { body: MOON, rand: seededRandom(i) });
      if (!shot) continue;
      for (let t = 0; t <= 240; t += 30) expect(sunAhead(shot.orbit, new Date(now.getTime() + t * 1000))).toBeGreaterThan(MOON.shots.darkBelowDeg);
    }
  });

  it('never comes up on Mars', () => {
    for (let i = 0; i < 200; i++) expect(chooseShot(new Date(START.getTime() + i * 0.37 * DAY), { body: MARS, rand: seededRandom(i) }).kind).not.toBe('earthrise');
  });
});

describe('Earth seen from the Moon', () => {
  it('turns to its real rotation: the point under the Moon matches sidereal time', () => {
    for (let i = 0; i < 20; i++) {
      const date = new Date(START.getTime() + i * 1.37 * DAY);
      const sub = latLon(toBody(bodyFrame({ ae: 'Earth' } as typeof MOON, date), vec.scale(earthFromMoon(date), -1)));
      // Geocentric, of date: an observer on the surface would see the Moon shifted by up to 1°.
      const m = A.RotateVector(A.Rotation_EQJ_EQD(date), A.GeoMoon(date));
      const eq = { ra: Math.atan2(m.y, m.x) / (Math.PI / 12), dec: Math.asin(m.z / Math.hypot(m.x, m.y, m.z)) / (Math.PI / 180) };
      const lon = ((((eq.ra - A.SiderealTime(date)) * 15) % 360) + 540) % 360 - 180;
      const ours = ((sub.lon % 360) + 540) % 360 - 180;
      // The IAU's simple Earth rotation model drifts about half a degree from sidereal time, under a pixel here.
      expect(Math.abs(sub.lat - eq.dec)).toBeLessThan(1);
      expect(Math.abs(((ours - lon + 540) % 360) - 180)).toBeLessThan(1);
    }
  });
});
