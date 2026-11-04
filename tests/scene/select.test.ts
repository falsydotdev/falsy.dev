import { describe, expect, it } from 'vitest';
import { orbitCameraPose } from '../../src/scene/camera';
import { vec, type Vec3 } from '../../src/scene/ephemeris';
import { dirOf, tileAt, tileId, parent } from '../../src/scene/tiles/cube';
import { type CameraPose, selectTiles } from '../../src/scene/tiles/select';

const R = 3396.19;
const opts = { radiusKm: R, heightRangeKm: [-8.2 * 2.5, 21.3 * 2.5] as [number, number], tilePx: 256, maxLevel: 7 };

function pose(altKm: number, tiltDeg: number): CameraPose {
  const rBody = vec.scale(dirOf(10, 30), R + altKm);
  const velocity = vec.cross([0, 0, 1], rBody);
  const { position, forward, up } = orbitCameraPose(rBody, velocity, R, tiltDeg);
  return { position, forward, up, fovYRad: (50 * Math.PI) / 180, aspect: 16 / 9, viewportHeightPx: 1080 };
}

/** Where a ray through screen point (sx, sy) in [-1, 1] first meets the sphere, if it does. */
function groundHit(cam: CameraPose, sx: number, sy: number): Vec3 | null {
  const f = vec.norm(cam.forward);
  const r = vec.norm(vec.cross(f, cam.up));
  const u = vec.cross(r, f);
  const ty = Math.tan(cam.fovYRad / 2);
  const d = vec.norm(vec.add(f, vec.add(vec.scale(r, sx * ty * cam.aspect), vec.scale(u, sy * ty))));
  const b = vec.dot(cam.position, d);
  const c = vec.dot(cam.position, cam.position) - R * R;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? vec.norm(vec.add(cam.position, vec.scale(d, t))) : null;
}

describe('tile selection from a 200 km orbit', () => {
  const cam = pose(200, 12);
  const tiles = selectTiles(cam, opts);
  const ids = new Set(tiles.map((t) => t.id));

  it('covers every visible ground point exactly once', () => {
    let hits = 0;
    for (let i = 0; i <= 40; i++) {
      for (let j = 0; j <= 40; j++) {
        const p = groundHit(cam, -1 + i / 20, -1 + j / 20);
        if (!p) continue;
        hits++;
        let covering = 0;
        for (let level = 0; level <= opts.maxLevel; level++) if (ids.has(tileId(tileAt(p, level)))) covering++;
        expect(covering).toBe(1);
      }
    }
    expect(hits).toBeGreaterThan(800);
  });

  it('never selects a tile together with one of its ancestors', () => {
    for (const t of tiles) {
      for (let k = parent(t.key); k; k = parent(k)) expect(ids.has(tileId(k))).toBe(false);
    }
  });

  it('keeps texels at or under a pixel unless the data runs out', () => {
    for (const t of tiles) if (t.key.level < opts.maxLevel) expect(t.texelPx).toBeLessThanOrEqual(1);
  });

  it('uses full-resolution tiles at the bottom of the frame', () => {
    const p = groundHit(cam, 0, -1)!;
    expect(ids.has(tileId(tileAt(p, opts.maxLevel)))).toBe(true);
  });

  it('culls the far side of the planet', () => {
    const behind = tileAt(vec.scale(cam.position, -1), 3);
    for (const t of tiles) expect(t.key.level === 3 && tileId(t.key) === tileId(behind)).toBe(false);
    expect(tiles.length).toBeLessThan(2000);
  });

  it('selects fewer tiles with a coarser texel limit', () => {
    expect(selectTiles(cam, { ...opts, maxTexelPx: 2 }).length).toBeLessThan(tiles.length);
  });
});
