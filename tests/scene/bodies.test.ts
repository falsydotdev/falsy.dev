import { describe, expect, it } from 'vitest';
import posters from '../../src/data/posters.json';
import { BODIES, EARTH, MARS, MOON, bodyById, listedBodyIds, nextBodyId } from '../../src/scene/bodies';

describe('per-body UI strings', () => {
  it('gives every body a loading label, spoken name, and data credit', () => {
    for (const body of Object.values(BODIES)) {
      expect(body.loadingLabel, body.id).toMatch(/\S/);
      expect(body.spokenName, body.id).toMatch(/\S/);
      expect(body.dataCredit, body.id).toMatch(/\S/);
    }
  });

  it('keeps the wording Mars and the Moon shipped with', () => {
    expect([MARS.loadingLabel, MARS.spokenName, MARS.dataCredit]).toEqual(['Mars terrain', 'Mars', 'MOLA elevation and Viking colour data']);
    expect([MOON.loadingLabel, MOON.spokenName, MOON.dataCredit]).toEqual(['lunar terrain', 'the Moon', 'LOLA elevation and LROC colour data']);
  });
});

/** Every body the switch button reaches, pressing it from `start` until it comes back round. */
function cycle(ids: string[], start: string, hasStills: (id: string) => boolean): string[] {
  const seen = [start];
  for (let id = nextBodyId(ids, start, hasStills); id !== start && seen.length <= ids.length; id = nextBodyId(ids, id, hasStills)) seen.push(id);
  return seen;
}

describe('poster-mode switching', () => {
  const ids = ['mars', 'moon', 'earth', 'jupiter'];
  const stills = new Set(['mars', 'jupiter']);
  const hasStills = (id: string) => stills.has(id);

  it('skips bodies without stills', () => {
    expect(nextBodyId(ids, 'mars', hasStills)).toBe('jupiter');
    expect(nextBodyId(ids, 'jupiter', hasStills)).toBe('mars');
    expect(nextBodyId(ids, 'moon', hasStills)).toBe('jupiter');
  });

  it('reaches every body with stills from any of them', () => {
    expect(cycle(ids, 'mars', hasStills)).toEqual(['mars', 'jupiter']);
    expect(cycle(ids, 'jupiter', hasStills)).toEqual(['jupiter', 'mars']);
  });

  it('stays put when no other body has stills', () => {
    expect(nextBodyId(ids, 'mars', (id) => id === 'mars')).toBe('mars');
  });

  it('visits every body in order when every body qualifies', () => {
    expect(nextBodyId(ids, 'jupiter')).toBe('mars');
    expect(cycle(ids, 'moon', () => true)).toEqual(['moon', 'earth', 'jupiter', 'mars']);
  });

  it('reaches every body that ships posters', () => {
    const bodies = Object.keys(BODIES);
    const withStills = new Set(posters.map((p) => p.body.toLowerCase()));
    for (const id of withStills) expect(bodies, id).toContain(id);
    for (const start of withStills) expect(new Set(cycle(bodies, start, (id) => withStills.has(id)))).toEqual(withStills);
  });
});

describe('bodies offered before their production tiles exist', () => {
  it('leaves Earth out of production picks and the switch button until it is listed', () => {
    expect(EARTH.listed).toBe(false);
    expect(listedBodyIds(false)).toEqual(['mars', 'moon']);
  });

  it('offers every body in development', () => {
    expect(listedBodyIds(true)).toEqual(['mars', 'moon', 'earth']);
  });

  it('still finds Earth by id, so `?body=earth` previews it', () => {
    expect(bodyById('earth')).toBe(EARTH);
  });
});
