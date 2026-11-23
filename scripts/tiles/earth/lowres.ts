// The Copernicus Sentinel-2 Global Mosaic's low-resolution product: 50 lat/lon tiles of 36°,
// each 10000² int16 samples at 0.0036° (about 400 m) with the origin at the north-west corner.

import type { Box, Grid, Window } from './grid.ts';
import { toneReflectance } from './sentinel.ts';

export const LOW_RES_STEP = 0.0036;
export const LOW_RES_SIZE = 10000;
const TILE_DEG = 36;

export interface LowResTile extends Box {
  name: string;
}

const pad = (v: number) => String(Math.abs(v)).padStart(3, '0');

export const LOW_RES_TILES: LowResTile[] = [54, 18, -18, -54, -90].flatMap((south) =>
  Array.from({ length: 360 / TILE_DEG }, (_, i) => {
    const west = -180 + TILE_DEG * i;
    const name = `${south < 0 ? 'S' : 'N'}${String(Math.abs(south)).padStart(2, '0')}${west < 0 ? 'W' : 'E'}${pad(west)}`;
    return { name, west, south, east: west + TILE_DEG, north: south + TILE_DEG };
  }),
);

/** Tiles that share area with `box`; a shared edge alone doesn't count. */
export function lowResTilesFor(box: Box): LowResTile[] {
  return LOW_RES_TILES.filter((t) => box.west < t.east && box.east > t.west && box.south < t.north && box.north > t.south);
}

export interface Quarter {
  year: number;
  quarter: number;
  firstMonth: string;
}

/** S3 key (bucket included) of one band of one tile. */
export const lowResKey = (q: Quarter, tile: string, band: string) =>
  `eodata/Global-Mosaics/Sentinel-2/S2MSI_L3__MCQ_LR/${q.year}/${q.firstMonth}/01/Sentinel-2_mosaic_${q.year}_Q${q.quarter}_${tile}_low_resolution/${band}.tif`;

const snap = (v: number) => Math.round(v * 1e6) / 1e6;

/** Pixels of `grid` whose centres fall inside `tile`, so every pixel has exactly one owner. */
export function targetWindow(grid: Grid, tile: Box): Window {
  const sx = grid.w / (grid.east - grid.west);
  const sy = grid.h / (grid.north - grid.south);
  const clip = (v: number, max: number) => Math.min(max, Math.max(0, Math.ceil(snap(v - 0.5))));
  return {
    x0: clip((tile.west - grid.west) * sx, grid.w),
    y0: clip((grid.north - tile.north) * sy, grid.h),
    x1: clip((tile.east - grid.west) * sx, grid.w),
    y1: clip((grid.north - tile.south) * sy, grid.h),
  };
}

/** Fractional sample column in `tile` under the centre of raster column `x` (sample centres at integers). */
export const sourceX = (grid: Grid, tile: Box, x: number) => (grid.west + ((x + 0.5) * (grid.east - grid.west)) / grid.w - tile.west) / LOW_RES_STEP - 0.5;

/** Fractional sample row in `tile` under the centre of raster row `y`. */
export const sourceY = (grid: Grid, tile: Box, y: number) => (tile.north - grid.north + ((y + 0.5) * (grid.north - grid.south)) / grid.h) / LOW_RES_STEP - 0.5;

/** The tile samples that bilinear taps for raster window `win` touch. */
export function sourceWindow(grid: Grid, tile: Box, win: Window): Window {
  const lo = (v: number) => Math.min(LOW_RES_SIZE - 1, Math.max(0, Math.floor(v)));
  return {
    x0: lo(sourceX(grid, tile, win.x0)),
    y0: lo(sourceY(grid, tile, win.y0)),
    x1: Math.min(LOW_RES_SIZE, lo(sourceX(grid, tile, win.x1 - 1)) + 2),
    y1: Math.min(LOW_RES_SIZE, lo(sourceY(grid, tile, win.y1 - 1)) + 2),
  };
}

/** Latitude of the centre of raster row `y`. */
export const rowLat = (grid: Grid, y: number) => grid.north - ((y + 0.5) * (grid.north - grid.south)) / grid.h;

/**
 * Where Sentinel-2 fades into Blue Marble, as [full weight, zero weight] latitudes, measured on the
 * 2025 Q4 mosaic. North: land nodata is 1% at 78°N, 21% at 79°N, and total past 80.5°N (polar night).
 * South: data stops at 82.81–82.84°S, but the ice sheet clips to textureless cream from about 67°S
 * while Blue Marble stays textured, so Blue Marble takes over from 70°S, where its coastline stops disagreeing.
 */
export const SENTINEL_RAMP = { quarter: 4, north: [76, 78.5], south: [-70, -82.75] } as const;

const smoothstep = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Sentinel-2's share of the colour at `lat`: 1 inside coverage, easing to 0 before each polar edge. */
export function sentinelWeight(lat: number): number {
  const [from, to] = lat >= 0 ? SENTINEL_RAMP.north : SENTINEL_RAMP.south;
  return 1 - smoothstep((lat - from) / (to - from));
}

export const NODATA = -32768;

export interface Samples {
  data: Int16Array;
  w: number;
  h: number;
}

/** Bilinear sample at (fx, fy), clamped to the window; nodata taps drop out and the rest are reweighted. */
export function sampleBilinear(src: Samples, fx: number, fy: number): number | null {
  const x = Math.min(src.w - 1, Math.max(0, fx));
  const y = Math.min(src.h - 1, Math.max(0, fy));
  const ix = Math.min(Math.max(0, src.w - 2), Math.floor(x));
  const iy = Math.min(Math.max(0, src.h - 2), Math.floor(y));
  const tx = x - ix;
  const ty = y - iy;
  let sum = 0;
  let weight = 0;
  const tap = (i: number, j: number, wgt: number) => {
    if (wgt === 0 || i >= src.w || j >= src.h) return;
    const v = src.data[j * src.w + i];
    if (v === NODATA) return;
    sum += v * wgt;
    weight += wgt;
  };
  tap(ix, iy, (1 - tx) * (1 - ty));
  tap(ix + 1, iy, tx * (1 - ty));
  tap(ix, iy + 1, (1 - tx) * ty);
  tap(ix + 1, iy + 1, tx * ty);
  return weight > 0 ? sum / weight : null;
}

/**
 * Tones one raster row from red, green, and blue samples (window coordinates) into `out`, land
 * pixels only: the renderer shades water itself, so Blue Marble stays under it. `weight` blends the
 * toned colour into the Blue Marble already in `out` (1 replaces it). Returns pixels written.
 */
export function overlayRow(bands: Samples[], fy: number, fxs: Float64Array, mask: Uint8Array, out: Uint8Array[], weight = 1): number {
  let written = 0;
  const px = [0, 0, 0];
  if (weight <= 0) return 0;
  for (let i = 0; i < fxs.length; i++) {
    if (mask[i] === 0) continue;
    let ok = true;
    for (let b = 0; b < 3 && ok; b++) {
      const dn = sampleBilinear(bands[b], fxs[i], fy);
      if (dn === null) ok = false;
      else px[b] = toneReflectance(dn, b) as number;
    }
    if (!ok) continue;
    for (let b = 0; b < 3; b++) out[b][i] = weight >= 1 ? px[b] : Math.round(out[b][i] + (px[b] - out[b][i]) * weight);
    written++;
  }
  return written;
}
