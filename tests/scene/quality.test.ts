import { describe, expect, it } from 'vitest';
import { Governor, initialTier, renderPixelRatio, shadowGrowth, tier } from '../../src/scene/quality.ts';

const opts = { warmup: 2, window: 4, patience: 2, limit: 0.5, giveUpLimit: 0.75 };
const feed = (g: Governor, load: number, n: number, showing = true) => Array.from({ length: n }, () => g.sample(load, showing));

describe('Governor', () => {
  it('ignores warmup frames', () => {
    const g = new Governor('high', opts);
    expect(feed(g, 9, 5)).toEqual(['hold', 'hold', 'hold', 'hold', 'hold']);
    expect(g.sample(9, true)).toBe('hold');
  });

  it('steps down on the first bad window while the scene is still hidden', () => {
    const g = new Governor('high', opts);
    expect(feed(g, 0.9, 6, false).at(-1)).toBe('down');
    expect(g.tier).toBe('medium');
  });

  it('waits for consecutive bad windows once the scene is showing', () => {
    const g = new Governor('high', opts);
    feed(g, 0.9, 6);
    expect(g.tier).toBe('high');
    expect(feed(g, 0.9, 4).at(-1)).toBe('down');
    expect(g.tier).toBe('medium');
  });

  it('forgives a single hitch', () => {
    const g = new Governor('high', opts);
    feed(g, 0.9, 6);
    feed(g, 0.2, 4);
    expect(feed(g, 0.9, 4).at(-1)).toBe('hold');
    expect(g.tier).toBe('high');
  });

  it('judges the median, not the worst frame', () => {
    const g = new Governor('high', opts);
    feed(g, 0, 2, false);
    expect([0.2, 0.3, 5, 0.2].map((l) => g.sample(l, false)).at(-1)).toBe('hold');
  });

  it('re-warms after a step down instead of judging the new tier on stale frames', () => {
    const g = new Governor('high', opts);
    feed(g, 0.9, 6, false);
    expect(feed(g, 0.9, 5, false)).toEqual(['hold', 'hold', 'hold', 'hold', 'hold']);
  });

  it('never steps up', () => {
    const g = new Governor('medium', opts);
    feed(g, 0.01, 40);
    expect(g.tier).toBe('medium');
  });

  it('gives up only past the higher limit at the lowest tier', () => {
    const g = new Governor('low', opts);
    expect(feed(g, 0.6, 6, false).at(-1)).toBe('hold');
    expect(feed(g, 0.8, 4, false).at(-1)).toBe('give-up');
    expect(g.tier).toBe('low');
  });
});

describe('initialTier', () => {
  it('sends software renderers to the poster', () => {
    expect(initialTier({ backend: 'WebGPU', vendor: 'google', architecture: 'swiftshader' })).toBe('poster');
    expect(initialTier({ backend: 'WebGL2', description: 'ANGLE (Mesa, llvmpipe (LLVM 15.0.7, 256 bits))' })).toBe('poster');
  });

  it('starts WebGL2 at low', () => {
    expect(initialTier({ backend: 'WebGL2', description: 'ANGLE (NVIDIA GeForce RTX 3060)' })).toBe('low');
  });

  it('starts known discrete and Apple GPUs at high, everything else at medium', () => {
    expect(initialTier({ backend: 'WebGPU', vendor: 'apple', architecture: 'common-3' })).toBe('high');
    expect(initialTier({ backend: 'WebGPU', vendor: 'nvidia' })).toBe('high');
    expect(initialTier({ backend: 'WebGPU', vendor: 'intel', architecture: 'gen-12lp' })).toBe('medium');
    expect(initialTier({ backend: 'WebGPU' })).toBe('medium');
  });
});

describe('renderPixelRatio', () => {
  it('caps by the tier ratio', () => {
    expect(renderPixelRatio(tier('high'), 2, 1512, 982)).toBe(2);
    expect(renderPixelRatio(tier('medium'), 2, 1512, 982)).toBe(1.25);
    expect(renderPixelRatio(tier('low'), 1, 1512, 982)).toBe(1);
  });

  it('caps by pixel count on very large screens', () => {
    const r = renderPixelRatio(tier('high'), 2, 2560, 1440);
    expect(2560 * 1440 * r * r).toBeCloseTo(8.3e6, -3);
  });
});

describe('shadowGrowth', () => {
  it('keeps the march reach the same at any step count', () => {
    const reach = (steps: number) => 2 * shadowGrowth(steps) ** steps;
    expect(reach(12)).toBeCloseTo(reach(44), 6);
    expect(reach(24)).toBeCloseTo(reach(44), 6);
  });
});
