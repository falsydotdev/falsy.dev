import { describe, expect, it } from 'vitest';
import { Governor, TIERS, initialTier, isIntegrated, renderPixelRatio, switchesFromStill, tier } from '../../src/scene/quality.ts';

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
    expect(renderPixelRatio(tier('high'), 2, 1512, 982)).toBe(1.25);
    expect(renderPixelRatio(tier('medium'), 2, 1512, 982)).toBe(1);
    expect(renderPixelRatio(tier('low'), 2, 1512, 982)).toBe(0.75);
    expect(renderPixelRatio(tier('high'), 1, 1512, 982)).toBe(1);
  });

  it('caps by pixel count on very large screens', () => {
    const r = renderPixelRatio(tier('high'), 2, 2560, 1440);
    expect(2560 * 1440 * r * r).toBeCloseTo(4.2e6, -3);
  });
});


describe('cloud effects per tier', () => {
  it('casts cloud shadows on High and Medium, not on Low', () => {
    expect(tier('high').cloudShadows).toBe(true);
    expect(tier('medium').cloudShadows).toBe(true);
    expect(tier('low').cloudShadows).toBe(false);
  });

  it('keeps cloud relief for High only', () => {
    expect(TIERS.filter((t) => t.cloudRelief).map((t) => t.name)).toEqual(['high']);
  });
});

describe('sun glint', () => {
  it('uses Cox-Munk on High and Medium and the cheaper GGX on Low', () => {
    expect(tier('high').glint).toBe('cox-munk');
    expect(tier('medium').glint).toBe('cox-munk');
    expect(tier('low').glint).toBe('ggx');
  });
});

describe('isIntegrated', () => {
  it('counts Intel graphics as integrated, except Arc cards', () => {
    expect(isIntegrated({ backend: 'WebGPU', vendor: 'intel', architecture: 'gen-12lp' })).toBe(true);
    expect(isIntegrated({ backend: 'WebGPU', vendor: 'intel', architecture: 'xe-lpg' })).toBe(true);
    expect(isIntegrated({ backend: 'WebGL2', description: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)' })).toBe(true);
    expect(isIntegrated({ backend: 'WebGPU', vendor: 'intel', architecture: 'xe-hpg', description: 'Intel(R) Arc(TM) A770 Graphics' })).toBe(false);
    expect(isIntegrated({ backend: 'WebGPU', vendor: 'intel', architecture: 'xe2-hpg' })).toBe(false);
    expect(isIntegrated({ backend: 'WebGL2', description: 'ANGLE (Intel, Intel(R) Arc(TM) B580 Graphics (0x0000E20B) Direct3D11 vs_5_0 ps_5_0, D3D11)' })).toBe(false);
  });

  it("counts Core Ultra chips' integrated Arc graphics as integrated", () => {
    expect(isIntegrated({ backend: 'WebGPU', vendor: 'intel', architecture: 'xe-lpg', description: 'Intel(R) Arc(TM) Graphics' })).toBe(true);
    expect(isIntegrated({ backend: 'WebGPU', vendor: 'intel', architecture: 'xe2-lpg', description: 'Intel(R) Arc(TM) 140V GPU (16GB)' })).toBe(true);
  });

  it("counts AMD's laptop Radeon graphics as integrated and its cards as discrete", () => {
    expect(isIntegrated({ backend: 'WebGPU', vendor: 'amd', architecture: 'rdna-3', description: 'AMD Radeon 780M Graphics' })).toBe(true);
    expect(isIntegrated({ backend: 'WebGL2', description: 'ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001681) Direct3D11 vs_5_0 ps_5_0, D3D11)' })).toBe(true);
    expect(isIntegrated({ backend: 'WebGPU', vendor: 'amd', architecture: 'rdna-3', description: 'AMD Radeon RX 7800 XT' })).toBe(false);
  });

  it('counts Apple, NVIDIA, and AMD with nothing more to go on as discrete', () => {
    expect(isIntegrated({ backend: 'WebGPU', vendor: 'apple', architecture: 'metal-3' })).toBe(false);
    expect(isIntegrated({ backend: 'WebGPU', vendor: 'nvidia', architecture: 'turing', description: 'NVIDIA GeForce GTX 1650' })).toBe(false);
    expect(isIntegrated({ backend: 'WebGPU', vendor: 'amd', architecture: 'rdna-3' })).toBe(false);
  });

  it('counts phone-class and Arm laptop GPUs as integrated', () => {
    expect(isIntegrated({ backend: 'WebGPU', vendor: 'qualcomm', architecture: 'adreno-7xx' })).toBe(true);
    expect(isIntegrated({ backend: 'WebGPU', vendor: 'arm', architecture: 'valhall' })).toBe(true);
  });
});

describe('switchesFromStill', () => {
  const scene = { tier: 'high', backend: 'WebGPU', integrated: false } as const;
  it('crossfades two live scenes on a discrete or Apple GPU above Low', () => {
    expect(switchesFromStill(scene)).toBe(false);
    expect(switchesFromStill({ ...scene, tier: 'medium' })).toBe(false);
  });

  it('switches from a frozen frame on Low, on WebGL2, once frozen, and on integrated GPUs, so two scenes never share memory', () => {
    expect(switchesFromStill({ ...scene, tier: 'low' })).toBe(true);
    expect(switchesFromStill({ ...scene, tier: 'frozen' })).toBe(true);
    expect(switchesFromStill({ ...scene, backend: 'WebGL2' })).toBe(true);
    expect(switchesFromStill({ ...scene, integrated: true })).toBe(true);
  });
});
