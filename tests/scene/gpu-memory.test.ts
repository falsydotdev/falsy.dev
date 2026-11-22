import { describe, expect, it } from 'vitest';
import { EARTH, MARS } from '../../src/scene/bodies';
import { MEMORY_CEILING_MB, atlasLayers, bytesPerLayer, memoryClass, msaaSamples, sceneGpuBytes, type MemoryClass } from '../../src/scene/gpu-memory';
import { tier, type TierName } from '../../src/scene/quality';

const earthLayers = EARTH.tiles.layers;
const MB = 1e6;

// A scene as the live scene sets it up: atlas depth from its start tier, MSAA from the canvas.
function plan(cls: MemoryClass, tierName: TierName, canvasPx: number, opts: { integrated?: boolean; preview?: boolean; ceilings?: boolean } = {}) {
  const layers = atlasLayers({ cls, tier: tierName, tileLayers: earthLayers, clouds: true });
  const common = { canvasPx, atlasLayers: layers, tileLayers: earthLayers, clouds: true, bloom: tier(tierName).bloom };
  const msaa = msaaSamples({ cls, tier: tierName, integrated: opts.integrated ?? cls === 'integrated', ceilings: opts.ceilings ?? true, preview: opts.preview ?? false, ...common }) > 0;
  return { layers, msaa, bytes: sceneGpuBytes({ ...common, msaa }) };
}
const cap = (t: TierName) => tier(t).maxMegapixels * 1e6;

describe('GPU memory per scene', () => {
  it("counts Earth's colour and city-light atlases with their mips and the height atlas without", () => {
    // 256² + 128² + … + 1² = 87,381 RGBA8 texels, 99² half floats, and 128² + … + 1² = 21,845 bytes of lights.
    expect(bytesPerLayer(earthLayers)).toBe(87_381 * 4 + 99 * 99 * 2 + 21_845);
  });

  it('sorts scenes by the ceiling that applies', () => {
    expect(memoryClass({ tier: 'high', backend: 'WebGPU', integrated: false })).toBe('discrete');
    expect(memoryClass({ tier: 'medium', backend: 'WebGPU', integrated: true })).toBe('integrated');
    expect(memoryClass({ tier: 'low', backend: 'WebGPU', integrated: false })).toBe('low');
    expect(memoryClass({ tier: 'low', backend: 'WebGL2', integrated: true })).toBe('low');
  });

  it('keeps an Earth scene under 400 MB on discrete and Apple GPUs, 300 MB on integrated, and 250 MB on Low and WebGL2, at every pixel cap', () => {
    const starts: [MemoryClass, TierName][] = [['discrete', 'high'], ['discrete', 'medium'], ['integrated', 'high'], ['integrated', 'medium'], ['low', 'low']];
    for (const [cls, t] of starts) expect(plan(cls, t, cap(t)).bytes / MB).toBeLessThanOrEqual(MEMORY_CEILING_MB[cls]);
  });

  it('keeps all 512 tiles per atlas on discrete and Apple GPUs', () => {
    expect(plan('discrete', 'high', cap('high')).layers).toBe(512);
    expect(atlasLayers({ cls: 'discrete', tier: 'high', tileLayers: MARS.tiles.layers, clouds: false })).toBe(512);
  });

  it('holds fewer tiles where the ceiling is lower, but never under 256', () => {
    const integrated = plan('integrated', 'medium', cap('medium')).layers;
    expect(integrated).toBeLessThan(512);
    expect(integrated).toBeGreaterThanOrEqual(256);
    expect(plan('low', 'low', cap('low')).layers).toBeGreaterThanOrEqual(256);
  });

  it('respects a device limit on array layers', () => {
    expect(atlasLayers({ cls: 'discrete', tier: 'high', tileLayers: earthLayers, clouds: true, maxLayers: 300 })).toBe(300);
  });
});

describe('msaaSamples', () => {
  it('keeps MSAA on a discrete or Apple GPU at High in a 1440×900 window at 2×', () => {
    expect(plan('discrete', 'high', 1800 * 1125).msaa).toBe(true);
  });

  it('drops MSAA where its buffers would push the scene past the ceiling: a 1512×982 window at 2× at High, a 1440p screen, a 5K screen', () => {
    expect(plan('discrete', 'high', 1890 * 1228).msaa).toBe(false);
    expect(plan('discrete', 'medium', 2560 * 1440).msaa).toBe(false);
    expect(plan('discrete', 'high', cap('high')).msaa).toBe(false);
  });

  it('keeps MSAA at any size for bodies the ceilings don\'t cover, except on Low and integrated GPUs', () => {
    expect(plan('discrete', 'high', cap('high'), { ceilings: false }).msaa).toBe(true);
    expect(plan('low', 'low', 1280 * 720, { ceilings: false }).msaa).toBe(false);
    expect(plan('integrated', 'medium', 1280 * 720, { ceilings: false }).msaa).toBe(false);
    expect(EARTH.memoryCeilings).toBe(true);
    expect(MARS.memoryCeilings ?? false).toBe(false);
  });

  it('never uses MSAA on Low or on integrated GPUs, however small the canvas', () => {
    expect(plan('low', 'low', 1280 * 720).msaa).toBe(false);
    expect(plan('integrated', 'medium', 1280 * 720).msaa).toBe(false);
    expect(plan('discrete', 'low', 1280 * 720).msaa).toBe(false);
    expect(plan('discrete', 'high', 1280 * 720, { integrated: true }).msaa).toBe(false);
  });

  it('keeps the tier\'s MSAA in a preview rendered at a chosen scale, as the posters are', () => {
    expect(plan('discrete', 'high', 2560 * 1440, { preview: true }).msaa).toBe(true);
    expect(plan('low', 'low', 2560 * 1440, { preview: true }).msaa).toBe(false);
  });
});
