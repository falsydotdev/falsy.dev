// Tile layers a body streams. Kept free of the height codec so the page bundle can read body
// configs without it (boot.ts loads layout.ts lazily).
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

export interface TileLayer {
  id: string;
  /**
   * How a tile decodes and uploads: sRGB RGBA image, the same with a mask in alpha (decoded
   * straight to the GPU so colour under alpha 0 survives), height codec, or a single-channel image.
   */
  format: 'color' | 'masked' | 'height' | 'mono';
  dir: string;
  ext: string;
  sizePx: number;
  maxLevel: number;
  /** Fetch only tiles where some ground sees the Sun below this elevation, in degrees. */
  sunBelowDeg?: number;
}

export const COLOR_LAYER: TileLayer = { id: 'color', format: 'color', dir: 'c', ext: 'avif', sizePx: TILES.colorPx, maxLevel: TILES.maxLevel };
export const HEIGHT_LAYER: TileLayer = { id: 'height', format: 'height', dir: 'h', ext: 'bin', sizePx: HEIGHT_SIZE, maxLevel: TILES.maxLevel };

// City lights: NASA Black Marble 2016 greyscale, display-encoded as published.
export const LIGHTS_LAYER: TileLayer = { id: 'lights', format: 'mono', dir: 'l', ext: 'avif', sizePx: 128, maxLevel: 6, sunBelowDeg: 5 };

export const layerPath = (layer: TileLayer, k: TileKey) => `${layer.dir}/${k.level}/${k.face}/${k.x}_${k.y}.${layer.ext}`;
