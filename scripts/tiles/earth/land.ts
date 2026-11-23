// The water mask: GEBCO height at or below sea level, except where Natural Earth's 1:10m land
// polygons say land (the Netherlands, the Dead Sea shore, Death Valley).
import type { Grid } from './grid.ts';

/** Rings of every polygon in a .shp file, each as flat [lon, lat, lon, lat, ...]. */
export function readShapefilePolygons(shp: Uint8Array): Float64Array[] {
  const view = new DataView(shp.buffer, shp.byteOffset, shp.byteLength);
  const rings: Float64Array[] = [];
  for (let at = 100; at + 8 <= shp.byteLength; ) {
    const length = view.getInt32(at + 4) * 2;
    const c = at + 8;
    at = c + length;
    if (view.getInt32(c, true) !== 5) continue;
    const parts = view.getInt32(c + 36, true);
    const points = view.getInt32(c + 40, true);
    const pts = c + 44 + 4 * parts;
    for (let p = 0; p < parts; p++) {
      const start = view.getInt32(c + 44 + 4 * p, true);
      const end = p + 1 < parts ? view.getInt32(c + 48 + 4 * p, true) : points;
      const ring = new Float64Array((end - start) * 2);
      for (let i = start; i < end; i++) {
        ring[(i - start) * 2] = view.getFloat64(pts + 16 * i, true);
        ring[(i - start) * 2 + 1] = view.getFloat64(pts + 16 * i + 8, true);
      }
      rings.push(ring);
    }
  }
  return rings;
}

/** Even-odd scanline fill of polygon rings onto a grid, one row at a time; 1 marks land. */
export class LandRaster {
  private edges: Float64Array;
  private byRow: Int32Array[];
  private grid: Grid;

  constructor(rings: Float64Array[], grid: Grid) {
    this.grid = grid;
    const sx = grid.w / (grid.east - grid.west);
    const sy = grid.h / (grid.north - grid.south);
    const edges: number[] = [];
    for (const r of rings) {
      for (let i = 0; i + 3 < r.length; i += 2) {
        const y0 = (grid.north - r[i + 1]) * sy;
        const y1 = (grid.north - r[i + 3]) * sy;
        if (y0 === y1) continue;
        edges.push((r[i] - grid.west) * sx, y0, (r[i + 2] - grid.west) * sx, y1);
      }
    }
    this.edges = Float64Array.from(edges);
    // Each edge is listed under every row whose pixel centre it spans.
    const lists: number[][] = Array.from({ length: grid.h }, () => []);
    for (let e = 0; e < this.edges.length; e += 4) {
      const lo = Math.min(this.edges[e + 1], this.edges[e + 3]);
      const hi = Math.max(this.edges[e + 1], this.edges[e + 3]);
      const first = Math.max(0, Math.ceil(lo - 0.5));
      const last = Math.min(grid.h - 1, Math.ceil(hi - 0.5) - 1);
      for (let y = first; y <= last; y++) lists[y].push(e);
    }
    this.byRow = lists.map((l) => Int32Array.from(l));
  }

  row(y: number, out = new Uint8Array(this.grid.w)): Uint8Array {
    out.fill(0);
    const yc = y + 0.5;
    const xs: number[] = [];
    for (const e of this.byRow[y]) {
      const [x0, y0, x1, y1] = this.edges.subarray(e, e + 4);
      xs.push(x0 + ((yc - y0) / (y1 - y0)) * (x1 - x0));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const from = Math.max(0, Math.ceil(xs[i] - 0.5));
      const to = Math.min(this.grid.w, Math.ceil(xs[i + 1] - 0.5));
      for (let x = from; x < to; x++) out[x] = 1;
    }
    return out;
  }
}

/** Mask bytes for the colour tiles' alpha: 255 is land, 0 is water. */
export function waterMaskRow(heights: ArrayLike<number>, land: Uint8Array, out: Uint8Array) {
  for (let i = 0; i < out.length; i++) out[i] = heights[i] <= 0 && !land[i] ? 0 : 255;
}
