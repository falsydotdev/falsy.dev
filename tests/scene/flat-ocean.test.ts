import { describe, expect, it } from 'vitest';
import { FlatOceanBuilder, isFlatOcean } from '../../src/scene/tiles/flat-ocean';

describe('flat-ocean bitmap', () => {
  it('packs one bit per tile, face-major then row-major, least significant bit first', () => {
    const b = new FlatOceanBuilder(1);
    b.set({ face: 2, level: 0, x: 0, y: 0 }, true);
    b.set({ face: 0, level: 1, x: 1, y: 1 }, true);
    b.set({ face: 1, level: 1, x: 0, y: 0 }, true);
    const json = b.toJSON();
    // Level 0: bit 2 set -> 0x04. Level 1: bits 3 and 4 set -> 0x18, two more zero bytes for 24 tiles.
    expect(json.levels).toEqual(['BA==', 'GAAA']);
  });

  it('answers per tile, and treats tiles past the bitmap as not flat', () => {
    const b = new FlatOceanBuilder(7);
    const sea = { face: 4, level: 7, x: 100, y: 37 };
    b.set(sea, true);
    b.set({ face: 4, level: 7, x: 101, y: 37 }, true);
    b.set({ face: 4, level: 7, x: 101, y: 37 }, false);
    const meta = JSON.parse(JSON.stringify(b.toJSON()));
    expect(isFlatOcean(meta, sea)).toBe(true);
    expect(isFlatOcean(meta, { face: 4, level: 7, x: 101, y: 37 })).toBe(false);
    expect(isFlatOcean(meta, { face: 4, level: 8, x: 0, y: 0 })).toBe(false);
    expect(isFlatOcean(undefined, sea)).toBe(false);
  });

  it('starts from an earlier bitmap, so a partial bake keeps the bits it did not touch', () => {
    const first = new FlatOceanBuilder(2);
    first.set({ face: 5, level: 2, x: 3, y: 3 }, true);
    const again = new FlatOceanBuilder(2, first.toJSON());
    again.set({ face: 0, level: 2, x: 0, y: 0 }, true);
    const meta = again.toJSON();
    expect(isFlatOcean(meta, { face: 5, level: 2, x: 3, y: 3 })).toBe(true);
    expect(isFlatOcean(meta, { face: 0, level: 2, x: 0, y: 0 })).toBe(true);
  });
});
