import { describe, expect, it } from 'vitest';
import { LandRaster, readShapefilePolygons, waterMaskRow } from '../../scripts/tiles/earth/land.ts';

/** A polygon shapefile (.shp) with one record per polygon, each a list of closed rings. */
function shapefile(polygons: number[][][][]) {
  const records = polygons.map((rings) => {
    const points = rings.flat();
    const content = 44 + 4 * rings.length + 16 * points.length;
    const b = new DataView(new ArrayBuffer(8 + content));
    b.setInt32(4, content / 2);
    b.setInt32(8, 5, true);
    b.setInt32(44, rings.length, true);
    b.setInt32(48, points.length, true);
    let start = 0;
    rings.forEach((r, i) => {
      b.setInt32(52 + 4 * i, start, true);
      start += r.length;
    });
    points.forEach(([x, y], i) => {
      b.setFloat64(52 + 4 * rings.length + 16 * i, x, true);
      b.setFloat64(60 + 4 * rings.length + 16 * i, y, true);
    });
    return new Uint8Array(b.buffer);
  });
  const total = 100 + records.reduce((a, r) => a + r.length, 0);
  const out = new Uint8Array(total);
  const head = new DataView(out.buffer);
  head.setInt32(0, 9994);
  head.setInt32(24, total / 2);
  head.setInt32(28, 1000, true);
  head.setInt32(32, 5, true);
  let at = 100;
  for (const r of records) out.set(r, at), (at += r.length);
  return out;
}

const square = (w: number, s: number, e: number, n: number) => [[w, s], [w, n], [e, n], [e, s], [w, s]];

describe('Natural Earth land raster', () => {
  it('reads polygon rings from a shapefile', () => {
    const shp = shapefile([[square(0, 0, 4, 4), square(1, 1, 3, 3)], [square(10, 10, 11, 11)]]);
    const rings = readShapefilePolygons(shp);
    expect(rings).toHaveLength(3);
    expect(Array.from(rings[2])).toEqual([10, 10, 10, 11, 11, 11, 11, 10, 10, 10]);
  });

  it('fills pixels whose centres fall inside, leaving holes open', () => {
    const rings = readShapefilePolygons(shapefile([[square(0, 0, 4, 4), square(1, 1, 3, 3)]]));
    const land = new LandRaster(rings, { w: 5, h: 4, west: 0, north: 4, east: 5, south: 0 });
    const rows = [0, 1, 2, 3].map((y) => Array.from(land.row(y)));
    expect(rows).toEqual([
      [1, 1, 1, 1, 0],
      [1, 0, 0, 1, 0],
      [1, 0, 0, 1, 0],
      [1, 1, 1, 1, 0],
    ]);
    expect(Array.from(land.row(1))).toEqual([1, 0, 0, 1, 0]);
  });
});

describe('water mask', () => {
  it('is water only at or below sea level and outside the land polygons', () => {
    const out = new Uint8Array(5);
    waterMaskRow(Int16Array.from([10, 0, -5, -5, 3]), Uint8Array.from([0, 0, 0, 1, 1]), out);
    expect(Array.from(out)).toEqual([255, 0, 0, 255, 255]);
  });
});
