import { describe, expect, it } from 'vitest';
import { QUAD_TILES, gridWindow, quadTilesFor } from '../../scripts/tiles/earth/grid.ts';

describe('90° source tiles (GEBCO GeoTIFFs, Blue Marble 500 m)', () => {
  it('names tiles by longitude letter and latitude digit', () => {
    expect(QUAD_TILES.map((t) => t.name)).toEqual(['A1', 'B1', 'C1', 'D1', 'A2', 'B2', 'C2', 'D2']);
    expect(QUAD_TILES.find((t) => t.name === 'D2')).toMatchObject({ west: 90, east: 180, north: 0, south: -90 });
  });

  it('finds the pixel window of each tile a box crosses', () => {
    const box = { west: -2, south: 50, east: 8, north: 54 };
    expect(quadTilesFor(box, 21600)).toEqual([
      { tile: QUAD_TILES[1], x0: 21120, y0: 8640, x1: 21600, y1: 9600 },
      { tile: QUAD_TILES[2], x0: 0, y0: 8640, x1: 1920, y1: 9600 },
    ]);
  });

  it('rounds a grid window outward to whole pixels', () => {
    const grid = { w: 360, h: 180, west: -180, north: 90, east: 180, south: -90 };
    expect(gridWindow(grid, { west: 10.5, south: -0.2, east: 12.1, north: 1 })).toEqual({ x0: 190, y0: 89, x1: 193, y1: 91 });
  });
});
