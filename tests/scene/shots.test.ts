import { describe, expect, it } from 'vitest';
import { DEG, vec, bodyVector, sunFrom, sunElevationAt as elevationOn, fromBody, bodyFrame } from '../../src/scene/ephemeris';
import { orbitCameraPose, project } from '../../src/scene/camera';
import { orbitalPeriod, sample } from '../../src/scene/orbit';
import { MARS } from '../../src/scene/bodies';
import { MARS_FEATURES } from '../../src/scene/features';

const sunJ2000 = (d: Date) => sunFrom(MARS, d);
const marsFrame = (d: Date) => bodyFrame(MARS, d);
const sunElevationAt = (d: Date, lat: number, lon: number) => elevationOn(MARS, d, lat, lon);
import { cameraRight, chooseShot, dawnDusk, featureFlyover, orbitalSunrise, seededRandom } from '../../src/scene/shots';

describe('repeatable shots', () => {
  const now = new Date('2026-11-03T12:00:00Z');

  it('builds the same shot from the same seed', () => {
    const a = chooseShot(now, { rand: seededRandom(42) });
    const b = chooseShot(now, { rand: seededRandom(42) });
    expect(a.kind).toBe(b.kind);
    expect(a.orbit).toEqual(b.orbit);
  });

  it('flies over a named feature at any time of day when asked', () => {
    const olympus = MARS_FEATURES.filter((f) => f.id === 'olympus-mons');
    const shot = featureFlyover(now, { features: olympus, anySun: true, rand: seededRandom(1) });
    expect(shot?.feature?.id).toBe('olympus-mons');
  });
});

function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Spread over a Mars year so seasons and lighting geometry vary.
const DATES = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2026, 10, 2) + i * 57.3 * 86400e3 + i * 3.7 * 3600e3));
const plus = (d: Date, s: number) => new Date(d.getTime() + s * 1000);
// A typical solved framing for a 16:10 laptop screen.
const VIEW = { tiltDeg: 0.5, rollDeg: 9.5, fovRad: 50 * DEG, aspect: 1.6 };
const onScreen = (point: readonly [number, number, number], r: readonly [number, number, number], v: readonly [number, number, number]) =>
  project(point, orbitCameraPose(r, v, MARS.radiusKm, VIEW.tiltDeg, VIEW.rollDeg), VIEW.fovRad, VIEW.aspect);

describe('dawn-dusk orbit', () => {
  it.each(DATES)('stays over the terminator for a full orbit from %s', (now) => {
    const { orbit } = dawnDusk(now, { rand: seeded(now.getTime()) });
    const T = orbitalPeriod(orbit);
    for (let s = 0; s <= T; s += 60) {
      const c = sample(orbit, plus(now, s));
      expect(Math.abs(vec.dot(vec.norm(c.rBody), c.sunBody))).toBeLessThan(Math.sin(0.5 * DEG));
      expect(c.shadow).toBe(false);
    }
  });

  it.each(DATES)('keeps the dayside on the right of the frame, from %s', (now) => {
    const { orbit } = dawnDusk(now, { rand: seeded(now.getTime()) });
    const c = sample(orbit, now);
    expect(vec.dot(sunJ2000(now), cameraRight(c.r, c.v))).toBeGreaterThan(0.99);
  });
});

describe('orbital sunrise', () => {
  it.each(DATES)('starts in shadow and leaves it about a minute later, from %s', (now) => {
    const { orbit, keyMoment } = orbitalSunrise(now, { rand: seeded(now.getTime()) });
    expect(sample(orbit, now).shadow).toBe(true);
    expect(sample(orbit, plus(now, 55)).shadow).toBe(true);
    expect(sample(orbit, plus(now, 65)).shadow).toBe(false);
    expect(sample(orbit, plus(now, 90)).shadow).toBe(false);
    expect(keyMoment!.getTime() - now.getTime()).toBe(60e3);
  });

  it.each(DATES)('breaks right of centre, from %s', (now) => {
    const { orbit, keyMoment } = orbitalSunrise(now, { rand: seeded(now.getTime()) });
    const c = sample(orbit, keyMoment!);
    const sunPoint = vec.add(c.r, vec.scale(sunJ2000(keyMoment!), 1e6));
    const [x] = onScreen(sunPoint, c.r, c.v)!;
    expect(x).toBeGreaterThan(0.15);
    expect(x).toBeLessThan(0.8);
  });
});

describe('feature flyover', () => {
  it.each(DATES)('passes about 100 km right of a low-Sun feature, Sun to the right, from %s', (now) => {
    const shot = featureFlyover(now, { rand: seeded(now.getTime()) });
    if (!shot) return;
    const { orbit, feature, keyMoment } = shot;
    const target = bodyVector(feature!.lat, feature!.lon);
    let closest = Infinity;
    for (let s = 0; s <= 600; s += 1) {
      const c = sample(orbit, plus(now, s));
      closest = Math.min(closest, MARS.radiusKm * Math.acos(Math.min(1, vec.dot(vec.norm(c.rBody), target))));
    }
    expect(closest).toBeGreaterThan(80);
    expect(closest).toBeLessThan(120);
    const start = sample(orbit, now);
    const featureNow = vec.scale(fromBody(marsFrame(now), target), MARS.radiusKm);
    const [x] = onScreen(featureNow, start.r, start.v)!;
    expect(x).toBeGreaterThan(0.05);
    const elevation = sunElevationAt(keyMoment!, feature!.lat, feature!.lon);
    expect(elevation).toBeGreaterThanOrEqual(5);
    expect(elevation).toBeLessThanOrEqual(25);
    const pass = sample(orbit, keyMoment!);
    const sunAngle = Math.acos(vec.dot(vec.norm(pass.v), sunJ2000(keyMoment!))) / DEG;
    expect(Math.abs(sunAngle - 90)).toBeLessThan(10);
    expect(vec.dot(sunJ2000(keyMoment!), cameraRight(pass.r, pass.v))).toBeGreaterThan(0);
  });

  it('finds a low-Sun feature on most dates', () => {
    const found = DATES.filter((d) => featureFlyover(d, { rand: seeded(1) }) !== null);
    expect(found.length).toBeGreaterThan(DATES.length / 2);
  });

  it('gives up when no listed feature has a low Sun', () => {
    expect(featureFlyover(DATES[0], { features: [] })).toBeNull();
  });
});

describe('shot choice', () => {
  it('falls back to dawn-dusk when a flyover has no feature', () => {
    const rolls = [0.95, 0.5, 0.5, 0.5];
    const rand = () => rolls.shift() ?? 0.5;
    expect(chooseShot(DATES[0], { rand, features: [] }).kind).toBe('dawn-dusk');
  });

  it('picks every kind over many loads', () => {
    const rand = seeded(42);
    const kinds = new Set(Array.from({ length: 40 }, () => chooseShot(DATES[3], { rand }).kind));
    expect(kinds).toEqual(new Set(['dawn-dusk', 'orbital-sunrise', 'feature-flyover']));
  });

  it('uses the shared feature list', () => {
    expect(MARS_FEATURES.length).toBeGreaterThanOrEqual(10);
  });
});
