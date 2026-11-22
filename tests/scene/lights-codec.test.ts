import { describe, expect, it } from 'vitest';
import { halveLights, lightOf } from '../../src/scene/tiles/lights-codec';

describe('city-light pixels', () => {
  it('read display grey as light, with full white as 1', () => {
    expect(lightOf(0)).toBe(0);
    expect(lightOf(255)).toBe(1);
    // 128/255 under a 2.2 gamma.
    expect(lightOf(128)).toBeCloseTo(0.2195, 4);
  });

  it('halve in light, so a lone bright pixel keeps its share of the light at a coarser level', () => {
    // A quarter of full white is grey 136 under a 2.2 gamma, not the 64 that averaging greys gives.
    expect([...halveLights(Uint8Array.from([255, 0, 0, 0]), 2)]).toEqual([136]);
  });

  it('halve flat grey to the same grey, block by block', () => {
    const px = new Uint8Array(16).fill(90);
    px.set([200, 200], 2);
    px.set([200, 200], 6);
    expect([...halveLights(px, 4)]).toEqual([90, 200, 90, 90]);
  });
});
