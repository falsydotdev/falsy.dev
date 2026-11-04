// Equi-angular cube-sphere tile addressing (Google's EAC layout). Face coordinates s, t run
// from -1 to 1 and map to angle linearly, so texels keep a near-constant size on the sphere.
// Directions are in the body frame: x toward lon 0, y toward lon 90°E, z north.

export type Vec3 = readonly [number, number, number];
export interface TileKey {
  face: number;
  level: number;
  x: number;
  y: number;
}

interface Face {
  n: Vec3;
  u: Vec3;
  v: Vec3;
}

// Every face has u × v = n, so tile winding is the same on all six.
export const FACES: readonly Face[] = [
  { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  { n: [0, 1, 0], u: [-1, 0, 0], v: [0, 0, 1] },
  { n: [-1, 0, 0], u: [0, -1, 0], v: [0, 0, 1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [0, 1, 0], v: [-1, 0, 0] },
  { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0] },
];

const QUARTER = Math.PI / 4;
const DEG = Math.PI / 180;

export const tileId = (k: TileKey) => `${k.level}/${k.face}/${k.x}/${k.y}`;

export function parseTileId(id: string): TileKey {
  const [level, face, x, y] = id.split('/').map(Number);
  return { face, level, x, y };
}

export function faceDir(face: number, s: number, t: number): Vec3 {
  const { n, u, v } = FACES[face];
  const a = Math.tan(s * QUARTER);
  const b = Math.tan(t * QUARTER);
  const x = n[0] + a * u[0] + b * v[0];
  const y = n[1] + a * u[1] + b * v[1];
  const z = n[2] + a * u[2] + b * v[2];
  const len = Math.hypot(x, y, z);
  return [x / len, y / len, z / len];
}

export function dirToFace(d: Vec3): { face: number; s: number; t: number } {
  const ax = Math.abs(d[0]);
  const ay = Math.abs(d[1]);
  const az = Math.abs(d[2]);
  let face: number;
  if (ax >= ay && ax >= az) face = d[0] > 0 ? 0 : 2;
  else if (ay >= az) face = d[1] > 0 ? 1 : 3;
  else face = d[2] > 0 ? 4 : 5;
  const { n, u, v } = FACES[face];
  const dn = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
  const du = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
  const dv = d[0] * v[0] + d[1] * v[1] + d[2] * v[2];
  return { face, s: Math.atan(du / dn) / QUARTER, t: Math.atan(dv / dn) / QUARTER };
}

/** Face-coordinate bounds of a tile. */
export function tileRect(k: TileKey) {
  const size = 2 / 2 ** k.level;
  return { s0: -1 + k.x * size, t0: -1 + k.y * size, size };
}

/** Direction at fractional position (fs, ft) in [0, 1] across a tile. */
export function tileDir(k: TileKey, fs: number, ft: number): Vec3 {
  const { s0, t0, size } = tileRect(k);
  return faceDir(k.face, s0 + fs * size, t0 + ft * size);
}

export function tileAt(d: Vec3, level: number): TileKey {
  const { face, s, t } = dirToFace(d);
  const n = 2 ** level;
  const clampIdx = (c: number) => Math.min(n - 1, Math.max(0, Math.floor(((c + 1) / 2) * n)));
  return { face, level, x: clampIdx(s), y: clampIdx(t) };
}

export const children = (k: TileKey): TileKey[] =>
  [0, 1, 2, 3].map((i) => ({ face: k.face, level: k.level + 1, x: k.x * 2 + (i & 1), y: k.y * 2 + (i >> 1) }));

export const parent = (k: TileKey): TileKey | null =>
  k.level === 0 ? null : { face: k.face, level: k.level - 1, x: k.x >> 1, y: k.y >> 1 };

export const roots = (): TileKey[] => FACES.map((_, face) => ({ face, level: 0, x: 0, y: 0 }));

/** Tile edge length along the face centre lines, which EAC makes the same for every tile at a level. */
export const tileEdgeKm = (level: number, radiusKm: number) => (radiusKm * (Math.PI / 2)) / 2 ** level;

/** Angular radius of the smallest cone around the tile's centre direction that holds the whole tile. */
export function tileAngularRadius(k: TileKey): number {
  const c = tileDir(k, 0.5, 0.5);
  let max = 0;
  for (const [fs, ft] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0], [0.5, 1], [0, 0.5], [1, 0.5]]) {
    const p = tileDir(k, fs, ft);
    max = Math.max(max, Math.acos(Math.min(1, c[0] * p[0] + c[1] * p[1] + c[2] * p[2])));
  }
  return max;
}

export function latLonOf(d: Vec3): { lat: number; lon: number } {
  return { lat: Math.asin(Math.max(-1, Math.min(1, d[2]))) / DEG, lon: Math.atan2(d[1], d[0]) / DEG };
}

export function dirOf(latDeg: number, lonDeg: number): Vec3 {
  const la = latDeg * DEG;
  const lo = lonDeg * DEG;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
}

/**
 * Lat/lon window that covers a tile, for reading source mosaics. Longitudes are in
 * [-180, 180); `lonMax` may exceed 180 when the window crosses the antimeridian.
 */
export function tileLatLonBounds(k: TileKey, steps = 16) {
  let latMin = 90;
  let latMax = -90;
  const lons: number[] = [];
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      if (i !== 0 && i !== steps && j !== 0 && j !== steps) continue;
      const { lat, lon } = latLonOf(tileDir(k, i / steps, j / steps));
      latMin = Math.min(latMin, lat);
      latMax = Math.max(latMax, lat);
      lons.push(lon);
    }
  }
  const containsPole = (z: number) => {
    const { face, s, t } = dirToFace([0, 0, z]);
    const r = tileRect(k);
    return face === k.face && s >= r.s0 && s <= r.s0 + r.size && t >= r.t0 && t <= r.t0 + r.size;
  };
  if (containsPole(1)) return { latMin, latMax: 90, lonMin: -180, lonMax: 180 };
  if (containsPole(-1)) return { latMin: -90, latMax, lonMin: -180, lonMax: 180 };
  // Smallest arc holding every boundary longitude: start just after the widest gap.
  lons.sort((a, b) => a - b);
  let gap = lons[0] + 360 - lons[lons.length - 1];
  let start = lons[0];
  for (let i = 1; i < lons.length; i++) {
    if (lons[i] - lons[i - 1] > gap) {
      gap = lons[i] - lons[i - 1];
      start = lons[i];
    }
  }
  const span = 360 - gap;
  // Edges of the tile bulge slightly between boundary samples; pad by a sample's width.
  const pad = (span / steps) * 0.05 + 1e-6;
  const lonMin = start - pad;
  return { latMin: Math.max(-90, latMin - pad), latMax: Math.min(90, latMax + pad), lonMin, lonMax: lonMin + span + 2 * pad };
}
