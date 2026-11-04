import type { TileKey } from './cube.ts';

// Colour tiles are texel-centred; height tiles are corner-aligned (shared edge samples) with a
// one-sample border so normals can be differenced right up to the tile edge.
// 96 cells puts full-resolution height samples 434 m apart, close to MOLA's 463 m. Heights
// are stored in 2 m steps, which stay invisible even after relief exaggeration.
export const TILES = {
  colorPx: 256,
  heightCells: 96,
  heightBorder: 1,
  heightStepM: 2,
  maxLevel: 7,
} as const;

export const HEIGHT_SIZE = TILES.heightCells + 1 + 2 * TILES.heightBorder;

export const colorPath = (k: TileKey) => `c/${k.level}/${k.face}/${k.x}_${k.y}.avif`;
export const heightPath = (k: TileKey) => `h/${k.level}/${k.face}/${k.x}_${k.y}.bin`;

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
