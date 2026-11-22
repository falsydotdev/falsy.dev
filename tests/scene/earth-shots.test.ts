import { describe, expect, it } from 'vitest';
import { EARTH } from '../../src/scene/bodies';
import { bodyFrame, bodyVector, fromBody, vec } from '../../src/scene/ephemeris';
import type { Feature } from '../../src/scene/features';
import { sample } from '../../src/scene/orbit';
import { cameraRight, featureFlyover, seededRandom, type Shot, worthShowing } from '../../src/scene/shots';

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
