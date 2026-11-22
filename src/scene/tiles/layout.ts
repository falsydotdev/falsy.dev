import type { TileKey } from './cube.ts';
import { COLOR_LAYER, HEIGHT_LAYER, HEIGHT_SIZE, TILES, layerPath } from './layers.ts';

export { TILES, HEIGHT_SIZE } from './layers.ts';

export const colorPath = (k: TileKey) => layerPath(COLOR_LAYER, k);
export const heightPath = (k: TileKey) => layerPath(HEIGHT_LAYER, k);

/** Coarse global equirectangular heights for long shadow rays, row 0 at 90°N, column 0 at 180°W. */
export const SHADOW_MAP = { path: 'shadow-heights.bin', width: 2048, height: 1024, stepM: 10 } as const;

/** Fractional tile position of height sample (i, j), border included, so i = 0 is just outside the tile. */
export const heightSampleFraction = (i: number) => (i - TILES.heightBorder) / TILES.heightCells;

// Height tiles (before gzip): HEIGHT_SIZE² row-major samples in heightStepM units. Each is
// stored as its residual from the gradient predictor left + up - upLeft, zigzag-coded, with
// all low bytes first and then all high bytes, which deflate compresses far better.
const predict = (g: Int32Array | Int16Array, i: number, j: number, n: number) => {
  const a = i ? g[j * n + i - 1] : j ? g[(j - 1) * n + i] : 0;
  const b = j ? g[(j - 1) * n + i] : a;
  const c = i && j ? g[(j - 1) * n + i - 1] : i ? a : b;
  return a + b - c;
};

/** Returns heights in metres. */
export function decodeHeights(bytes: Uint8Array, w = HEIGHT_SIZE, h = w, stepM: number = TILES.heightStepM): Float32Array {
  const count = w * h;
  const steps = new Int32Array(count);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      const z = bytes[k] | (bytes[count + k] << 8);
      steps[k] = ((z >>> 1) ^ -(z & 1)) + predict(steps, i, j, w);
    }
  }
  const out = new Float32Array(count);
  for (let k = 0; k < count; k++) out[k] = steps[k] * stepM;
  return out;
}

/** Takes heights in metres. */
export function encodeHeights(metres: ArrayLike<number>, w = HEIGHT_SIZE, h = w, stepM: number = TILES.heightStepM): Uint8Array {
  const count = w * h;
  const steps = new Int32Array(count);
  for (let k = 0; k < count; k++) steps[k] = Math.round(metres[k] / stepM);
  const out = new Uint8Array(count * 2);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      const r = steps[k] - predict(steps, i, j, w);
      const z = (r << 1) ^ (r >> 31);
      out[k] = z & 255;
      out[count + k] = (z >> 8) & 255;
    }
  }
  return out;
}
