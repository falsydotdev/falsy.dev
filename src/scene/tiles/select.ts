// Picks which quadtree tiles to draw for a camera, by screen-space texel size, with horizon
// and frustum culling. Shared by the renderer and the download-budget measurement.
import { type TileKey, type Vec3, children, parent, roots, tileAngularRadius, tileDir, tileEdgeKm, tileId } from './cube.ts';

export interface CameraPose {
  /** Camera position in the body frame, km from the planet centre. */
  position: Vec3;
  forward: Vec3;
  up: Vec3;
  fovYRad: number;
  aspect: number;
  viewportHeightPx: number;
}

export interface SelectOptions {
  radiusKm: number;
  /** Lowest and highest terrain heights in km, after relief exaggeration. */
  heightRangeKm: [number, number];
  tilePx: number;
  maxLevel: number;
  /** Largest allowed size of one texel on screen, in pixels, before a tile splits. */
  maxTexelPx?: number;
  /**
   * Beyond this distance the texel limit grows in proportion, since far terrain sits behind
   * more haze and is foreshortened anyway. Infinite by default.
   */
  relaxBeyondKm?: number;
}

export interface Selected {
  key: TileKey;
  id: string;
  distanceKm: number;
  texelPx: number;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => scale(a, 1 / Math.hypot(a[0], a[1], a[2]));

/** Inward-facing side planes of the view frustum, as [normal, offset] with dot(n, p) + d >= 0 inside. */
function frustumPlanes(cam: CameraPose): [Vec3, number][] {
  const f = norm(cam.forward);
  const r = norm(cross(f, cam.up));
  const u = cross(r, f);
  const ty = Math.tan(cam.fovYRad / 2);
  const tx = ty * cam.aspect;
  const side = (axis: Vec3, sign: number, t: number) => norm(add(scale(axis, sign), scale(f, t)));
  const normals = [side(r, 1, tx), side(r, -1, tx), side(u, 1, ty), side(u, -1, ty)];
  return normals.map((n) => [n, -dot(n, cam.position)]);
}

/** Bounding sphere of a tile shell between two radii, around its centre direction. */
function tileSphere(c: Vec3, alpha: number, rLow: number, rHigh: number) {
  const z0 = (rLow * Math.cos(alpha) + rHigh) / 2;
  const pts = [
    [rHigh, 0],
    [rLow, 0],
    [rHigh * Math.cos(alpha), rHigh * Math.sin(alpha)],
    [rLow * Math.cos(alpha), rLow * Math.sin(alpha)],
  ];
  const radius = Math.max(...pts.map(([z, x]) => Math.hypot(z - z0, x)));
  return { centre: scale(c, z0), radius };
}

export function selectTiles(cam: CameraPose, opts: SelectOptions): Selected[] {
  const R = opts.radiusKm;
  const rLow = R + opts.heightRangeKm[0];
  const rHigh = R + opts.heightRangeKm[1];
  const maxTexelPx = opts.maxTexelPx ?? 1;
  const relaxBeyondKm = opts.relaxBeyondKm ?? Infinity;
  const camDist = Math.hypot(...cam.position);
  const camDir = scale(cam.position, 1 / camDist);
  // Anything farther round the planet than this central angle is below the horizon.
  const horizon = Math.acos(Math.min(1, rLow / camDist)) + Math.acos(Math.min(1, rLow / rHigh));
  const planes = frustumPlanes(cam);
  const pxAngle = cam.fovYRad / cam.viewportHeightPx;
  const out: Selected[] = [];

  const visit = (key: TileKey) => {
    const c = tileDir(key, 0.5, 0.5);
    const alpha = tileAngularRadius(key);
    const theta = Math.acos(Math.max(-1, Math.min(1, dot(c, camDir))));
    if (theta - alpha > horizon) return;
    const { centre, radius } = tileSphere(c, alpha, rLow, rHigh);
    for (const [n, d] of planes) if (dot(n, centre) + d < -radius) return;

    const distanceKm = Math.max(Math.hypot(...sub(centre, cam.position)) - radius, 1e-3);
    const texelPx = tileEdgeKm(key.level, R) / opts.tilePx / (distanceKm * pxAngle);
    const limit = maxTexelPx * Math.max(1, distanceKm / relaxBeyondKm);
    if (texelPx > limit && key.level < opts.maxLevel) {
      for (const child of children(key)) visit(child);
      return;
    }
    out.push({ key, id: tileId(key), distanceKm, texelPx });
  };

  for (const root of roots()) visit(root);
  return out;
}

/**
 * Tiles to download for a selection: each selected tile plus its parent, so a tile that is
 * still loading can borrow texels from at most one level up. Levels below `pinnedLevel`
 * are always loaded.
 */
export function tilesToFetch(selected: Selected[], pinnedLevel = 1): TileKey[] {
  const out = new Map<string, TileKey>();
  for (let level = 0; level <= pinnedLevel; level++) {
    const n = 2 ** level;
    for (let face = 0; face < 6; face++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out.set(tileId({ face, level, x, y }), { face, level, x, y });
  }
  for (const s of selected) {
    out.set(s.id, s.key);
    const p = parent(s.key);
    if (p) out.set(tileId(p), p);
  }
  return [...out.values()];
}
