// Where Earth has city lights, coarsely, for shot planning on the CPU (the night pass and the home
// pass). The grid is NASA Black Marble 2016 averaged into 1° cells; scene code imports it, so it
// ships with the scene chunk, never the page. Light is 0 to 1: the share of a cell's area at the
// source's full white, so a cell whose every pixel is saturated reads 1.
import { EARTH } from './bodies.ts';
import { LIGHTS_GRID_BASE64 } from './lights-grid.ts';

export const LIGHTS_GRID_CELL_DEG = 1;

export interface LightsGrid {
  cellDeg: number;
  cols: number;
  rows: number;
  /** One byte a cell, row 0 at 90°N and column 0 at 180°W; see `encodeLight`. */
  values: Uint8Array;
}

// A cube root spends the byte's steps on dim cells, so a small town still reads above 0.
export const encodeLight = (light: number): number => Math.round(255 * Math.cbrt(Math.min(1, Math.max(0, light))));
const decode = (b: number) => (b / 255) ** 3;

/** A grid over `values`, `cellDeg` degrees a cell. */
export function lightsGrid(values: Uint8Array, cellDeg: number): LightsGrid {
  return { cellDeg, cols: 360 / cellDeg, rows: 180 / cellDeg, values };
}

let earth: LightsGrid | undefined;
const earthGrid = () => (earth ??= lightsGrid(Uint8Array.from(atob(LIGHTS_GRID_BASE64), (c) => c.charCodeAt(0)), LIGHTS_GRID_CELL_DEG));

const rowOf = (g: LightsGrid, lat: number) => Math.min(g.rows - 1, Math.max(0, Math.floor((90 - lat) / g.cellDeg)));
const colOf = (g: LightsGrid, lon: number) => (((Math.floor((lon + 180) / g.cellDeg) % g.cols) + g.cols) % g.cols);

/** Mean light of the cell holding latitude `lat`, longitude `lon` (degrees, any turn). */
export function lightsAt(lat: number, lon: number, grid: LightsGrid = earthGrid()): number {
  return decode(grid.values[rowOf(grid, lat) * grid.cols + colOf(grid, lon)]);
}

/**
 * Area-weighted mean light of the cells whose centres lie within `radiusKm` of the point along the
 * ground, plus the cell holding it. For judging what a view sees, not one spot.
 */
export function lightsAround(lat: number, lon: number, radiusKm: number, grid: LightsGrid = earthGrid()): number {
  const DEG = Math.PI / 180;
  const reach = radiusKm / EARTH.radiusKm;
  const r0 = rowOf(grid, lat);
  const c0 = colOf(grid, lon);
  const [sinLat, cosLat] = [Math.sin(lat * DEG), Math.cos(lat * DEG)];
  const span = Math.ceil(reach / DEG / grid.cellDeg) + 1;
  let sum = 0;
  let weight = 0;
  for (let r = Math.max(0, r0 - span); r <= Math.min(grid.rows - 1, r0 + span); r++) {
    const cLat = (90 - (r + 0.5) * grid.cellDeg) * DEG;
    const w = Math.cos(cLat);
    // Columns near the poles crowd together, so a whole row can fall within reach.
    const cols = Math.min(grid.cols, 2 * Math.ceil(span / Math.max(Math.cos(cLat), 1e-3)) + 1);
    for (let k = 0; k < cols; k++) {
      const c = (((c0 - (cols >> 1) + k) % grid.cols) + grid.cols) % grid.cols;
      const cLon = (-180 + (c + 0.5) * grid.cellDeg) * DEG;
      const cos = sinLat * Math.sin(cLat) + cosLat * w * Math.cos(cLon - lon * DEG);
      if (Math.acos(Math.min(1, Math.max(-1, cos))) > reach && !(r === r0 && c === c0)) continue;
      sum += w * decode(grid.values[r * grid.cols + c]);
      weight += w;
    }
  }
  return weight > 0 ? sum / weight : 0;
}
