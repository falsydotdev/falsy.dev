import { describe, expect, it } from 'vitest';
import { EARTH } from '../../src/scene/bodies';
import type { Feature } from '../../src/scene/features';
import { featureFlyover, seededRandom, worthShowing } from '../../src/scene/shots';

const equator: Feature = { id: 'equator', name: 'Equator', lat: 0, lon: 0 };

describe('whether the view ahead is worth showing', () => {
  it('turns down an Earth flyover in the middle of the night, and keeps one under a morning Sun', () => {
    const night = featureFlyover(new Date('2026-03-20T00:00:00Z'), { body: EARTH, features: [equator], anySun: true, rand: seededRandom(1) })!;
    const morning = featureFlyover(new Date('2026-03-20T06:50:00Z'), { body: EARTH, features: [equator], anySun: true, rand: seededRandom(1) })!;
    expect(worthShowing(night, night.keyMoment!)).toBe(false);
    expect(worthShowing(morning, morning.keyMoment!)).toBe(true);
  });
});
