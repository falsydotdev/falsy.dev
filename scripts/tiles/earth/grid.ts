/** A north-up lat/lon raster: w × h pixels spanning west..east and north..south degrees, pixel-is-area. */
export interface Grid {
  w: number;
  h: number;
  west: number;
  north: number;
  east: number;
  south: number;
}

export interface Box {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface Window {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Pixels of `grid` that touch `box`, clipped to the grid. */
export function gridWindow(grid: Grid, box: Box): Window {
  const sx = grid.w / (grid.east - grid.west);
  const sy = grid.h / (grid.north - grid.south);
  // Snap away float noise so a box edge on a pixel edge doesn't pull in a neighbour.
  const snap = (v: number) => Math.round(v * 1e6) / 1e6;
  return {
    x0: Math.max(0, Math.floor(snap((box.west - grid.west) * sx))),
    y0: Math.max(0, Math.floor(snap((grid.north - box.north) * sy))),
    x1: Math.min(grid.w, Math.ceil(snap((box.east - grid.west) * sx))),
    y1: Math.min(grid.h, Math.ceil(snap((grid.north - box.south) * sy))),
  };
}

export interface QuadTile extends Box {
  name: string;
}

/** The 90°×90° tiling GEBCO and Blue Marble both ship in: A–D from 180°W eastward, 1 north, 2 south. */
export const QUAD_TILES: QuadTile[] = [1, 2].flatMap((row) =>
  ['A', 'B', 'C', 'D'].map((letter, i) => ({
    name: `${letter}${row}`,
    west: -180 + 90 * i,
    east: -90 + 90 * i,
    north: row === 1 ? 90 : 0,
    south: row === 1 ? 0 : -90,
  })),
);

/** The tiles of `size`² pixels that `box` crosses, with the window inside each. */
export function quadTilesFor(box: Box, size: number) {
  return QUAD_TILES.filter((t) => box.west < t.east && box.east > t.west && box.south < t.north && box.north > t.south).map((tile) => ({
    tile,
    ...gridWindow({ w: size, h: size, ...tile }, box),
  }));
}
