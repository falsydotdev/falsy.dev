import { describe, expect, it } from 'vitest';
import { orbitCameraPose } from '../../src/scene/camera';
import { vec, type Vec3 } from '../../src/scene/ephemeris';
import { type TileKey, dirOf, tileAt, tileDir, tileId, parent } from '../../src/scene/tiles/cube';
import { type CameraPose, drawnHeightRangeKm, isOpenSea, layerTilesToFetch, layerWants, selectTiles, tilesToFetch } from '../../src/scene/tiles/select';
import { FlatOceanBuilder } from '../../src/scene/tiles/flat-ocean';
import type { TileLayer } from '../../src/scene/tiles/layers';
import { EARTH, MARS, MOON } from '../../src/scene/bodies';

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

describe('tiles to fetch', () => {
  const tiles = selectTiles(pose(200, 12), opts);
  const fetchIds = (keys: TileKey[]) => new Set(keys.map(tileId));

  it('loads every selected tile, its parent, and all of levels 0 and 1', () => {
    const keys = tilesToFetch(tiles);
    const ids = fetchIds(keys);
    expect(ids.size).toBe(keys.length);
    for (const t of tiles) expect(ids.has(t.id)).toBe(true);
    for (const t of tiles) if (t.key.level > 0) expect(ids.has(tileId(parent(t.key)!))).toBe(true);
    expect(keys.filter((k) => k.level === 0)).toHaveLength(6);
    expect(keys.filter((k) => k.level === 1)).toHaveLength(24);
  });

  it('pins deeper levels on request', () => {
    expect(tilesToFetch([], { pinnedLevel: 2 })).toHaveLength(6 + 24 + 96);
  });

  it('loads the selected tiles, level 0, and coarse shared ancestors when lean', () => {
    const keys = tilesToFetch(tiles, { lean: true });
    const selected = new Set(tiles.map((t) => t.id));
    expect(keys.filter((k) => k.level === 0)).toHaveLength(6);
    for (const k of keys) expect(k.level <= 4 || selected.has(tileId(k))).toBe(true);
    const coarse = (k: TileKey | null): TileKey | null => (k && k.level > 4 ? coarse(parent(k)) : k);
    for (const t of tiles) if (t.key.level > 0) expect(fetchIds(keys).has(tileId(coarse(parent(t.key))!))).toBe(true);
    for (const t of tiles) expect(fetchIds(keys).has(t.id)).toBe(true);
    expect(keys.length).toBeLessThan(tilesToFetch(tiles).length);
  });
});

describe('a body with an extra tile layer', () => {
  const tiles = selectTiles(pose(200, 12), opts);
  const keys = tilesToFetch(tiles);
  const fetchIdsOf = (ks: TileKey[]) => new Set(ks.map(tileId));
  const lights: TileLayer = { id: 'lights', format: 'mono', dir: 'l', ext: 'avif', sizePx: 128, maxLevel: 6, sunBelowDeg: 5 };

  it('fetches a capped layer from ancestors at its cap, covering every selected tile', () => {
    const capped = { ...lights, sunBelowDeg: undefined };
    const ids = new Set(layerTilesToFetch(keys, capped).map(tileId));
    expect(Math.max(...[...ids].map((id) => Number(id.split('/')[0])))).toBe(6);
    for (const t of tiles) {
      let k: TileKey | null = t.key;
      while (k && k.level > 6) k = parent(k);
      expect(ids.has(tileId(k!))).toBe(true);
    }
  });

  it('fetches a night-only layer for every tile with ground under a Sun below its limit, and skips full daylight', () => {
    // Sun 90° east of the camera's ground point, so the terminator runs under the camera.
    const sun = dirOf(10, 120);
    const ids = new Set(layerTilesToFetch(keys, lights, sun).map(tileId));
    const capped = layerTilesToFetch(keys, { ...lights, sunBelowDeg: undefined });
    let night = 0;
    let day = 0;
    for (const k of capped) {
      let minDeg = 90;
      for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) minDeg = Math.min(minDeg, (Math.asin(vec.dot(tileDir(k, i / 4, j / 4), sun)) * 180) / Math.PI);
      if (minDeg < 5) expect(ids.has(tileId(k))).toBe(true), night++;
      if (minDeg > 8) expect(ids.has(tileId(k))).toBe(false), day++;
    }
    expect(night).toBeGreaterThan(20);
    expect(day).toBeGreaterThan(20);
  });

  it('fetches nothing of a night-only layer under a high Sun', () => {
    expect(layerTilesToFetch(keys.filter((k) => k.level >= 4), lights, dirOf(10, 30))).toHaveLength(0);
  });

  it('leaves Mars and the Moon fetching exactly the colour and height tiles they always did', () => {
    const all = [...fetchIdsOf(keys)].sort();
    for (const body of [MARS, MOON]) {
      expect(body.tiles.layers.map((l) => l.id)).toEqual(['color', 'height']);
      for (const layer of body.tiles.layers) expect([...fetchIdsOf(layerTilesToFetch(keys, layer, dirOf(10, 120)))].sort()).toEqual(all);
    }
  });
});

describe("Earth's tiles", () => {
  const ER = EARTH.radiusKm;
  const earthPose = (): CameraPose => {
    const rBody = vec.scale(dirOf(52.3, 5.3), ER + EARTH.altKm);
    const { position, forward, up } = orbitCameraPose(rBody, vec.cross([0, 0, 1], rBody), ER, 12);
    return { position, forward, up, fovYRad: (50 * Math.PI) / 180, aspect: 16 / 9, viewportHeightPx: 1080 };
  };
  const [colour, height] = EARTH.tiles.layers;
  const sea = { face: 4, level: 5, x: 3, y: 9 };
  const ocean = new FlatOceanBuilder(7);
  ocean.set(sea, true);
  ocean.set({ face: 4, level: 1, x: 0, y: 0 }, true);
  const flatOcean = ocean.toJSON();

  it('selects about as many tiles from 400 km as Mars does from 200 km', () => {
    const range = drawnHeightRangeKm([-10436, 7173], EARTH);
    const earth = selectTiles(earthPose(), { radiusKm: ER, heightRangeKm: range, tilePx: 256, maxLevel: 7 });
    const mars = selectTiles(pose(200, 12), opts);
    expect(earth.length / mars.length).toBeGreaterThan(0.6);
    expect(earth.length / mars.length).toBeLessThan(1.6);
  });

  it('bounds the terrain at sea level, since the sea is drawn flat', () => {
    expect(drawnHeightRangeKm([-10436, 7173], EARTH)).toEqual([0, 7.173 * 2.5]);
    expect(drawnHeightRangeKm([-8200, 21300], MARS)).toEqual([-8.2 * 2.5, 21.3 * 2.5]);
  });

  it('skips the height tiles of open ocean, but still fetches their colour', () => {
    expect(layerWants(sea, height, undefined, flatOcean)).toBe(false);
    expect(layerWants(sea, colour, undefined, flatOcean)).toBe(true);
    expect(layerWants({ ...sea, x: 4 }, height, undefined, flatOcean)).toBe(true);
    const keys = [sea, { ...sea, x: 4 }];
    expect(layerTilesToFetch(keys, height, undefined, flatOcean).map(tileId)).toEqual([tileId({ ...sea, x: 4 })]);
  });

  it('keeps the pinned fallback levels, which every drawn tile can borrow heights from', () => {
    expect(layerWants({ face: 4, level: 1, x: 0, y: 0 }, height, undefined, flatOcean)).toBe(true);
  });

  it('marks open-sea tiles, which draw at sea level without any height tile', () => {
    expect(isOpenSea(sea, flatOcean)).toBe(true);
    expect(isOpenSea({ ...sea, x: 4 }, flatOcean)).toBe(false);
    expect(isOpenSea({ face: 4, level: 1, x: 0, y: 0 }, flatOcean)).toBe(false);
  });

  it('reads no flat ocean on a body without the bitmap', () => {
    expect(layerWants(sea, height, undefined, undefined)).toBe(true);
  });
});
