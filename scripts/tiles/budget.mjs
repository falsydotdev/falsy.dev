// Estimates tile downloads for real orbits: runs the renderer's tile selection and fetch
// policy along an orbit and sums the sizes of the baked tiles it would request.
//   node scripts/tiles/budget.mjs [--seconds 90] [--height 1440] [--shots 12]
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { TILE_DIR } from './paths.mjs';
import { selectTiles, tilesToFetch } from '../../src/scene/tiles/select.ts';
import { tileId } from '../../src/scene/tiles/cube.ts';
import { TILES, SHADOW_MAP, colorPath, heightPath } from '../../src/scene/tiles/layout.ts';
import { orbitCameraPose } from '../../src/scene/camera.ts';
import { marsFrame, vec } from '../../src/scene/ephemeris.ts';
import { sample } from '../../src/scene/orbit.ts';
import { dawnDusk, featureFlyover, orbitalSunrise } from '../../src/scene/shots.ts';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const SECONDS = arg('seconds', 90);
const HEIGHT_PX = arg('height', 1440);
const SHOTS = arg('shots', 12);
const ASPECT = 16 / 9;
const FOV = 50;
const RELIEF = 2.5;
const BASE = join(TILE_DIR, 'mars');
const meta = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(join(BASE, 'meta.json'), 'utf8')));
const heightRangeKm = meta.heightRangeM.map((m) => (m / 1000) * RELIEF);

const sizeCache = new Map();
const size = (path) => {
  if (!sizeCache.has(path)) {
    try {
      sizeCache.set(path, statSync(join(BASE, path)).size);
    } catch {
      sizeCache.set(path, NaN);
    }
  }
  return sizeCache.get(path);
};

function run(shot, { tiltDeg, maxTexelPx }) {
  const fetched = new Set();
  let color = 0;
  let height = size(SHADOW_MAP.path);
  let missing = 0;
  let firstView = 0;
  let peakTiles = 0;
  for (let t = 0; t <= SECONDS; t += 1) {
    const date = new Date(shot.orbit.epoch.getTime() + t * 1000);
    const s = sample(shot.orbit, date);
    const f = marsFrame(date);
    const vBody = [vec.dot(s.v, f.x), vec.dot(s.v, f.y), vec.dot(s.v, f.z)];
    const pose = orbitCameraPose(s.rBody, vBody, meta.radiusKm, tiltDeg);
    const selected = selectTiles(
      { ...pose, fovYRad: (FOV * Math.PI) / 180, aspect: ASPECT, viewportHeightPx: HEIGHT_PX },
      { radiusKm: meta.radiusKm, heightRangeKm, tilePx: TILES.colorPx, maxLevel: TILES.maxLevel, maxTexelPx },
    );
    peakTiles = Math.max(peakTiles, selected.length);
    for (const k of tilesToFetch(selected)) {
      const id = tileId(k);
      if (fetched.has(id)) continue;
      fetched.add(id);
      const c = size(colorPath(k));
      const h = size(heightPath(k));
      if (Number.isNaN(c)) missing++;
      else color += c;
      height += Number.isNaN(h) ? 0 : h;
    }
    if (t === 0) firstView = color + height;
  }
  return { firstView, total: color + height, color, height, tiles: fetched.size, peakTiles, missing };
}

const now = new Date();
const shots = [];
for (let i = 0; i < SHOTS; i++) {
  const at = new Date(now.getTime() + i * 2.1 * 3600e3);
  const opts = { altKm: 200, rand: () => (i * 0.618) % 1 };
  shots.push(i % 3 === 0 ? dawnDusk(at, opts) : i % 3 === 1 ? orbitalSunrise(at, opts) : featureFlyover(at, opts) ?? dawnDusk(at, opts));
}

const MB = (b) => (b / 1e6).toFixed(1);
console.log(`viewport ${Math.round(HEIGHT_PX * ASPECT)}×${HEIGHT_PX}, ${SHOTS} shots, ${SECONDS} s of orbit each\n`);
console.log('tilt  texel≤  first view MB  after 90 s MB (colour/height)  tiles fetched  peak drawn  missing');
for (const tiltDeg of [12, 15, 18, 25, 35]) {
  for (const maxTexelPx of [1, 1.5, 2]) {
    const runs = shots.map((s) => run(s, { tiltDeg, maxTexelPx }));
    const avg = (k) => runs.reduce((a, r) => a + r[k], 0) / runs.length;
    const worst = Math.max(...runs.map((r) => r.total));
    console.log(
      `${String(tiltDeg).padStart(4)}°  ${String(maxTexelPx).padStart(5)}   ${MB(avg('firstView')).padStart(12)}   ${MB(avg('total')).padStart(6)} (${MB(avg('color'))}/${MB(avg('height'))}) worst ${MB(worst)}  ${String(Math.round(avg('tiles'))).padStart(8)}  ${String(Math.round(avg('peakTiles'))).padStart(9)}  ${Math.round(avg('missing'))}`,
    );
  }
}
