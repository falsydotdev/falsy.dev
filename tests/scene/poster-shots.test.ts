import { describe, expect, it } from 'vitest';
import { posterMoments } from '../../clouds/worker/keep.js';
import shots from '../../scripts/posters/shots.json';
import { BODIES, EARTH } from '../../src/scene/bodies';

const params = (s: { query: string }) => new URLSearchParams(s.query);
const earth = shots.filter((s) => params(s).get('body') === 'earth');

describe('poster shots', () => {
  it('pins every shot to a moment on a known body, with its own id and label', () => {
    expect(new Set(shots.map((s) => s.id)).size).toBe(shots.length);
    for (const s of shots) {
      const p = params(s);
      expect(Object.keys(BODIES), s.id).toContain(p.get('body'));
      expect(Number.isNaN(Date.parse(p.get('at') ?? '')), s.id).toBe(false);
      expect(s.label, s.id).toMatch(/\S/);
      expect(s.id.startsWith(`${p.get('body')}-`), s.id).toBe(true);
    }
  });

  it('keeps Mars first, since the first still is the share image and the fallback poster', () => {
    expect(shots[0].id).toBe('mars-olympus');
    const firstEarth = shots.findIndex((s) => params(s).get('body') === 'earth');
    expect(shots.slice(firstEarth).every((s) => params(s).get('body') === 'earth')).toBe(true);
  });

  it('gives Earth a terminator, an orbital sunrise, a night pass, and an ocean glint', () => {
    expect(earth.map((s) => s.id).sort()).toEqual(['earth-glint', 'earth-night-pass', 'earth-sunrise', 'earth-terminator']);
    const kind = (id: string) => params(earth.find((s) => s.id === id)!).get('shot');
    expect(kind('earth-terminator')).toBe('dawn-dusk');
    expect(kind('earth-sunrise')).toBe('orbital-sunrise');
    expect(kind('earth-night-pass')).toBe('night-pass');
    expect(kind('earth-glint')).toBe('orbital-sunrise');
    for (const s of earth) expect(params(s).has('seed'), s.id).toBe(true);
  });

  it("asks the cloud job to keep each Earth still's moment, and no other body's", () => {
    const moments = posterMoments(shots);
    expect(moments).toHaveLength(earth.length);
    for (const s of earth) {
      const p = params(s);
      const moment = new Date(Date.parse(p.get('at')!) + Number(p.get('skip') ?? 0) * 1000).toISOString();
      expect(moments, s.id).toContain(moment);
    }
    expect(EARTH.clouds).toBeTruthy();
  });
});
