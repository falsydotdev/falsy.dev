import { describe, expect, it } from 'vitest';
import { DEG, vec, bodyVector, sunJ2000, sunElevationAt } from '../../src/scene/ephemeris';
import { MARS, orbitalPeriod, sample } from '../../src/scene/orbit';
import { MARS_FEATURES } from '../../src/scene/features';
import { chooseShot, dawnDusk, featureFlyover, orbitalSunrise } from '../../src/scene/shots';

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
});

describe('feature flyover', () => {
  it.each(DATES)('passes within 50 km of a low-Sun feature, Sun to the side, from %s', (now) => {
    const shot = featureFlyover(now, { rand: seeded(now.getTime()) });
    if (!shot) return;
    const { orbit, feature, keyMoment } = shot;
    const target = bodyVector(feature!.lat, feature!.lon);
    let closest = Infinity;
    for (let s = 0; s <= 600; s += 1) {
      const c = sample(orbit, plus(now, s));
      closest = Math.min(closest, MARS.radiusKm * Math.acos(Math.min(1, vec.dot(vec.norm(c.rBody), target))));
    }
    expect(closest).toBeLessThan(50);
    const elevation = sunElevationAt(keyMoment!, feature!.lat, feature!.lon);
    expect(elevation).toBeGreaterThanOrEqual(5);
    expect(elevation).toBeLessThanOrEqual(25);
    const pass = sample(orbit, keyMoment!);
    const sunAngle = Math.acos(vec.dot(vec.norm(pass.v), sunJ2000(keyMoment!))) / DEG;
    expect(Math.abs(sunAngle - 90)).toBeLessThan(10);
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
