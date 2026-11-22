import { describe, expect, it } from 'vitest';
import { EARTH } from '../../src/scene/bodies';
import { bodyFrame, bodyVector, fromBody, sunElevationAt, sunFrom, vec } from '../../src/scene/ephemeris';
import { EARTH_FEATURES, type Feature } from '../../src/scene/features';
import { sample } from '../../src/scene/orbit';
import { cameraRight, chooseShot, dawnDusk, featureFlyover, flyoverFeatures, orbitalSunrise, seededRandom, type Shot, sunAhead, wantsReshoot, worthShowing } from '../../src/scene/shots';

const equator: Feature = { id: 'equator', name: 'Equator', lat: 0, lon: 0 };

describe('whether the view ahead is worth showing', () => {
  it('turns down an Earth flyover in the middle of the night, and keeps one under a morning Sun', () => {
    const night = featureFlyover(new Date('2026-03-20T00:00:00Z'), { body: EARTH, features: [equator], anySun: true, rand: seededRandom(1) })!;
    const morning = featureFlyover(new Date('2026-03-20T06:50:00Z'), { body: EARTH, features: [equator], anySun: true, rand: seededRandom(1) })!;
    expect(worthShowing(night, night.keyMoment!)).toBe(false);
    expect(worthShowing(morning, morning.keyMoment!)).toBe(true);
  });
});

const plus = (d: Date, s: number) => new Date(d.getTime() + s * 1000);

// The closest the ground track comes to the feature, in km, and which side the feature passes on.
function pass(shot: Shot) {
  const target = bodyVector(shot.feature!.lat, shot.feature!.lon);
  let closest = { km: Infinity, right: 0 };
  for (let s = 0; s <= 600; s++) {
    const c = sample(shot.orbit, plus(shot.orbit.epoch, s));
    const km = EARTH.radiusKm * Math.acos(Math.min(1, vec.dot(vec.norm(c.rBody), target)));
    if (km < closest.km) closest = { km, right: vec.dot(fromBody(bodyFrame(EARTH, c.date), target), cameraRight(c.r, c.v)) };
  }
  return closest;
}

describe('a flyover past a place that is not in the feature list', () => {
  const home: Feature = { id: 'home', name: 'Home', lat: 48.2, lon: 16.4 };

  it('passes it on the right at the distance asked for', () => {
    const shot = featureFlyover(new Date('2026-06-21T03:00:00Z'), { body: EARTH, features: [home], anySun: true, offsetKm: 150 })!;
    const { km, right } = pass(shot);
    expect(km).toBeGreaterThan(140);
    expect(km).toBeLessThan(160);
    expect(right).toBeGreaterThan(0);
  });
});

describe('Earth features', () => {
  it('are named places with east longitudes and low-Sun windows', () => {
    expect(EARTH_FEATURES.length).toBeGreaterThanOrEqual(20);
    expect(new Set(EARTH_FEATURES.map((f) => f.id)).size).toBe(EARTH_FEATURES.length);
    for (const f of EARTH_FEATURES) {
      expect(f.name.length).toBeGreaterThan(0);
      expect(Math.abs(f.lat)).toBeLessThan(90);
      expect(f.lon).toBeGreaterThanOrEqual(0);
      expect(f.lon).toBeLessThan(360);
      if (f.sun) expect(f.sun.min).toBeLessThan(f.sun.max);
    }
  });

  // Earth turns once a day, so each feature is in its window for a couple of hours; they need to
  // be spread round the globe for a flyover to be on offer most of the time.
  it('offer a flyover with lit ground in most hours of the year', () => {
    const hours = Array.from({ length: 365 }, (_, d) => new Date(Date.UTC(2026, 0, 1) + d * 86400e3 + ((d * 7) % 24) * 3600e3 + (d % 4) * 900e3));
    const covered = hours.filter((h) => flyoverFeatures(EARTH, h).length > 0).length;
    expect(covered / hours.length).toBeGreaterThan(0.85);
  });
});

// Spread over a year and round the clock.
const DATES = Array.from({ length: 24 }, (_, i) => new Date(Date.UTC(2026, 0, 3) + i * 15.2 * 86400e3 + i * 5.3 * 3600e3));

describe('Earth feature flyover', () => {
  it.each(DATES)('passes about 100 km right of a feature in its Sun window, with the Sun on the right, from %s', (now) => {
    const shot = featureFlyover(now, { body: EARTH, rand: seededRandom(now.getTime()) })!;
    expect(shot.kind).toBe('feature-flyover');
    const { km, right } = pass(shot);
    expect(km).toBeGreaterThan(90);
    expect(km).toBeLessThan(110);
    expect(right).toBeGreaterThan(0);
    const { min, max } = shot.feature!.sun ?? { min: 5, max: 25 };
    const elevation = sunElevationAt(EARTH, shot.keyMoment!, shot.feature!.lat, shot.feature!.lon);
    expect(elevation).toBeGreaterThanOrEqual(min);
    expect(elevation).toBeLessThanOrEqual(max);
    const c = sample(shot.orbit, shot.keyMoment!);
    expect(vec.dot(sunFrom(EARTH, shot.keyMoment!), cameraRight(c.r, c.v))).toBeGreaterThan(0);
    expect(worthShowing(shot, shot.keyMoment!)).toBe(true);
  });
});

describe("Earth's shot mix", () => {
  const loads = Array.from({ length: 400 }, (_, i) => chooseShot(new Date(Date.UTC(2026, 0, 1) + i * 0.913 * 86400e3), { body: EARTH, rand: seededRandom(i) }));
  const share = (kind: string) => loads.filter((s) => s.kind === kind).length / loads.length;

  it('favours flying past a named place, with terminator passes and sunrises for the rest', () => {
    expect(share('feature-flyover')).toBeGreaterThan(0.33);
    expect(share('feature-flyover')).toBeLessThan(0.47);
    expect(share('dawn-dusk')).toBeGreaterThan(0.24);
    expect(share('orbital-sunrise')).toBeGreaterThan(0.24);
    expect(share('dawn-dusk') + share('orbital-sunrise') + share('feature-flyover')).toBe(1);
  });

  it('builds every shot from the 400 km orbit', () => {
    for (const s of loads) expect(s.orbit.a).toBeCloseTo(EARTH.radiusKm + 400, 6);
  });

  it.each(DATES)('runs the terminator pass 3 to 5° into daylight, from %s', (now) => {
    const { orbit } = dawnDusk(now, { body: EARTH, rand: seededRandom(now.getTime()) });
    for (let t = 0; t <= 300; t += 60) {
      const c = sample(orbit, plus(now, t));
      const elevation = Math.asin(vec.dot(vec.norm(c.rBody), c.sunBody)) / (Math.PI / 180);
      expect(elevation).toBeGreaterThan(3);
      expect(elevation).toBeLessThan(5);
    }
  });

  it.each(DATES)('starts the sunrise in shadow a minute before the Sun clears the limb, from %s', (now) => {
    const { orbit, keyMoment } = orbitalSunrise(now, { body: EARTH, rand: seededRandom(now.getTime()) });
    expect(keyMoment!.getTime() - now.getTime()).toBe(60e3);
    expect(sample(orbit, plus(now, 55)).shadow).toBe(true);
    expect(sample(orbit, plus(now, 65)).shadow).toBe(false);
  });
});

describe('re-shooting Earth', () => {
  const firstWanted = (shot: Shot, built: Date, untilS: number) => {
    // The scene checks every frame; 5 s is under a third of a degree of orbit.
    for (let t = 0; t <= untilS; t += 5) if (wantsReshoot(shot, built, plus(built, t))) return t;
    return null;
  };

  // In renders heading into night, the frame averages 11 of 255 with the Sun 4° below the ground
  // ahead, 7 at −5°, and 3 (close to black) at −6°.
  it.each(DATES)('plays a sunrise out, then swaps before the view ahead goes black, from %s', (built) => {
    const shot = orbitalSunrise(built, { body: EARTH, rand: seededRandom(built.getTime()) });
    const t = firstWanted(shot, built, 3 * 3600)!;
    expect(t).toBeGreaterThan(30 * 60);
    expect(t).toBeLessThan(70 * 60);
    expect(sunAhead(shot.orbit, plus(built, t))).toBeGreaterThan(-6);
  });

  it.each(DATES)('replaces a flyover only after its pass, from %s', (built) => {
    const shot = featureFlyover(built, { body: EARTH, rand: seededRandom(built.getTime()) })!;
    const t = firstWanted(shot, built, 3 * 3600);
    if (t !== null) expect(plus(built, t).getTime()).toBeGreaterThanOrEqual(shot.keyMoment!.getTime() + 120e3);
  });

  // At its lowest the Sun is 4° under the ground ahead, and the lit limb still fills the right of the frame.
  it.each(DATES)('keeps the terminator pass, which never leaves twilight, from %s', (built) => {
    expect(firstWanted(dawnDusk(built, { body: EARTH, rand: seededRandom(built.getTime()) }), built, 3 * 3600)).toBeNull();
  });
});
