// Rasters the Earth mosaic step writes and the cutters read. Each is a raw file of planar bands
// (band b, row y starts at (b·h + y)·w samples) beside a JSON header with its grid. A body can
// have several of a kind (a global coarse fill plus a fine box); samplers use the finest that covers a point.
import { readdirSync, readFileSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { MOSAIC_DIR } from './paths.mjs';

export const BYTES = { int16: 2, uint8: 1 };

/** Rasters of `kind` ('heights', 'mask', 'colour'), finest first. */
export function listRasters(kind) {
  let names = [];
  try {
    names = readdirSync(MOSAIC_DIR).filter((n) => n.startsWith(`${kind}-`) && n.endsWith('.json'));
  } catch {
    return [];
  }
  return names
    .map((n) => ({ ...JSON.parse(readFileSync(join(MOSAIC_DIR, n), 'utf8')), file: join(MOSAIC_DIR, n.replace(/\.json$/, '.bin')) }))
    .sort((a, b) => pixelDeg(a) - pixelDeg(b));
}

export const pixelDeg = (r) => (r.east - r.west) / r.w;
export const isGlobal = (r) => r.east - r.west >= 360 && r.north - r.south >= 180;

/** Pixel size in metres at the equator, for picking mips. */
export const pixelM = (r) => pixelDeg(r) * 111319.49;

export const covers = (r, lat, lon) => (isGlobal(r) || (lon >= r.west && lon <= r.east)) && lat >= r.south && lat <= r.north;

export async function writeHeader(kind, tag, grid, type, bands) {
  await mkdir(MOSAIC_DIR, { recursive: true });
  const header = { w: grid.w, h: grid.h, west: grid.west, north: grid.north, east: grid.east, south: grid.south, type, bands };
  await writeFile(join(MOSAIC_DIR, `${kind}-${tag}.json`), JSON.stringify(header, null, 2));
  return join(MOSAIC_DIR, `${kind}-${tag}.bin`);
}
