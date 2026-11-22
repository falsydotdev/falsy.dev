import { describe, expect, it } from 'vitest';
import pinned from './fixtures/mars-moon-shots.json';
import { recordShots } from './shot-record';

// Recorded before re-shooting became a per-kind judgement; Mars and the Moon must not drift from it.
describe('Mars and Moon shots', () => {
  const now = recordShots();
  it.each(Object.keys(pinned))('match the recorded orbits and re-shoot timings: %s', (key) => {
    expect(now[key]).toEqual(pinned[key as keyof typeof pinned]);
  });
});
