// Browsers don't report GPU memory, so a scene's is tallied here from what it allocates
// (`state.gpuMemoryMB`), and its atlas depth and MSAA are chosen to fit the spec's ceilings.
import type { TileLayer } from './tiles/layers.ts';
import { tier as tierByName, type Tier, type TierName } from './quality.ts';
import { CLOUD_TEXTURE } from './clouds.ts';
import { SHADOW_MAP } from './tiles/layout.ts';

const MB = 1e6;
export const MEMORY_CEILING_MB = { discrete: 400, integrated: 300, low: 250 } as const;
export type MemoryClass = keyof typeof MEMORY_CEILING_MB;

/** Discrete and Apple GPUs, integrated GPUs, or a scene that starts on Low or WebGL2. */
export function memoryClass(s: { tier: TierName; backend: 'WebGPU' | 'WebGL2'; integrated: boolean }): MemoryClass {
  if (s.tier === 'low' || s.backend === 'WebGL2') return 'low';
  return s.integrated ? 'integrated' : 'discrete';
}

const MAX_LAYERS = 512;
// Below this many tiles per atlas, terrain blurs on every screen; the planner won't go lower.
const MIN_LAYERS = 256;
export const MSAA_SAMPLES = 4;

// Bytes per canvas pixel. Swap chain: three BGRA8 buffers, plus the renderer's depth buffer.
const CANVAS_BPP = 3 * 4 + 4;
// The scene pass: RGBA16F colour and a 32-bit depth texture.
const PASS_BPP = 8 + 4;
// Its multisampled colour and depth, resolved into the above.
const MSAA_BPP = MSAA_SAMPLES * (8 + 4);
// Bloom: a half-size RGBA16F bright pass, then horizontal and vertical blurs over five halving mips.
const BLOOM_BPP = 8 / 4 + 2 * 8 * (1 / 4 + 1 / 16 + 1 / 64 + 1 / 256 + 1 / 1024);
// Geometry, instance buffers, atmosphere tables, the Sun, stars, and Earth's disc on the Moon.
const OTHER_BYTES = 8 * MB;

const FORMAT_BYTES = { color: 4, masked: 4, height: 2, mono: 1 } as const;
const MIPPED = { color: true, masked: true, height: false, mono: true } as const;

/** Bytes of one array layer across every atlas the body streams. */
export function bytesPerLayer(layers: readonly Pick<TileLayer, 'sizePx' | 'format'>[]) {
  return layers.reduce((sum, l) => {
    let px = l.sizePx * l.sizePx;
    if (MIPPED[l.format]) for (let s = l.sizePx >> 1; s >= 1; s >>= 1) px += s * s;
    return sum + px * FORMAT_BYTES[l.format];
  }, 0);
}

export interface SceneMemory {
  canvasPx: number;
  msaa: boolean;
  bloom: boolean;
  atlasLayers: number;
  tileLayers: readonly Pick<TileLayer, 'sizePx' | 'format'>[];
  clouds: boolean;
}

function fixedBytes(m: Pick<SceneMemory, 'clouds'>) {
  const shadow = SHADOW_MAP.width * SHADOW_MAP.height * 2;
  const clouds = m.clouds ? (CLOUD_TEXTURE.width * CLOUD_TEXTURE.height * 4) / 3 : 0;
  return shadow + clouds + OTHER_BYTES;
}

const perPixel = (m: Pick<SceneMemory, 'msaa' | 'bloom'>) => CANVAS_BPP + PASS_BPP + (m.msaa ? MSAA_BPP : 0) + (m.bloom ? BLOOM_BPP : 0);

export function sceneGpuBytes(m: SceneMemory) {
  return fixedBytes(m) + m.atlasLayers * bytesPerLayer(m.tileLayers) + m.canvasPx * perPixel(m);
}

const capPx = (t: Tier) => t.maxMegapixels * 1e6;

// Tiles per atlas, fixed for the scene's life: as many as fit under the ceiling with the canvas at
// the start tier's pixel cap and no MSAA, from 256 to 512.
export function atlasLayers(o: { cls: MemoryClass; tier: TierName; tileLayers: SceneMemory['tileLayers']; clouds: boolean; maxLayers?: number }) {
  const t = tierByName(o.tier);
  const max = Math.min(MAX_LAYERS, o.maxLayers ?? MAX_LAYERS);
  const room = MEMORY_CEILING_MB[o.cls] * MB - fixedBytes(o) - capPx(t) * perPixel({ msaa: false, bloom: t.bloom });
  const fit = Math.floor(room / bytesPerLayer(o.tileLayers) / 32) * 32;
  return Math.min(max, Math.max(MIN_LAYERS, fit));
}

// Never on Low or integrated GPUs. Elsewhere, under the ceilings, only while the buffers fit at the
// canvas's current size; a preview `scale=` keeps it regardless, as the posters need.
export function msaaSamples(o: { cls: MemoryClass; tier: TierName; integrated: boolean; ceilings: boolean; preview: boolean } & Omit<SceneMemory, 'msaa'>) {
  if (o.tier === 'low' || o.integrated) return 0;
  if (!o.ceilings || o.preview) return MSAA_SAMPLES;
  return sceneGpuBytes({ ...o, msaa: true }) <= MEMORY_CEILING_MB[o.cls] * MB ? MSAA_SAMPLES : 0;
}
