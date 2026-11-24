// Estimates tile downloads for real orbits: runs the renderer's tile selection and fetch
// policy along an orbit and sums the sizes of the baked tiles it would request.
//   node scripts/tiles/budget.mjs [--body mars] [--seconds 90] [--height 1440] [--shots 12]
// Against a partial bake, a missing tile counts as the mean size of its layer's baked tiles at
// that level (the "estimated" column). Earth adds its cloud map, which every first view loads.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { TILE_DIR } from './paths.mjs';
import { LOOKAHEAD_S, drawnHeightRangeKm, layerTilesFor, selectTiles } from '../../src/scene/tiles/select.ts';
import { tileId } from '../../src/scene/tiles/cube.ts';
import { TILES, SHADOW_MAP } from '../../src/scene/tiles/layout.ts';
import { layerPath } from '../../src/scene/tiles/layers.ts';
import { orbitCameraPose } from '../../src/scene/camera.ts';
import { bodyFrame, vec } from '../../src/scene/ephemeris.ts';
import { bodyById } from '../../src/scene/bodies.ts';
import { sample } from '../../src/scene/orbit.ts';
import { dawnDusk, featureFlyover, orbitalSunrise } from '../../src/scene/shots.ts';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const SECONDS = arg('seconds', 90);
const HEIGHT_PX = arg('height', 1440);
const SHOTS = arg('shots', 12);
// The renderer also loads for the pose this far ahead once the view settles, capped and throttled;
// counting all of it, uncapped, makes this an upper bound. 0 leaves it out.
const LOOKAHEAD = arg('lookahead', LOOKAHEAD_S);
const ASPECT = 16 / 9;
const FOV = 50;
const bodyArg = process.argv.indexOf('--body');
const BODY = bodyById(bodyArg > 0 ? process.argv[bodyArg + 1] : 'mars');
const BASE = join(TILE_DIR, BODY.id);
const meta = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(join(BASE, 'meta.json'), 'utf8')));
const heightRangeKm = drawnHeightRangeKm(meta.heightRangeM, BODY);
const LAYERS = BODY.tiles.layers;
const MAX_LEVEL = Math.max(...LAYERS.map((l) => l.maxLevel));
const LABELS = { color: 'colour' };

// Mean baked file size per layer directory and level, for tiles a partial bake lacks.
const meanCache = new Map();
const meanSize = (layer, level) => {
  const key = `${layer.dir}/${level}`;
  if (!meanCache.has(key)) {
    let n = 0;
    let sum = 0;
    try {
      for (const f of readdirSync(join(BASE, layer.dir, String(level)), { recursive: true })) {
        if (!String(f).endsWith(`.${layer.ext}`)) continue;
        n++;
        sum += statSync(join(BASE, layer.dir, String(level), String(f))).size;
      }
    } catch {}
    meanCache.set(key, n ? sum / n : 0);
  }
  // A level the bake never reached takes the nearest coarser level's mean.
  return meanCache.get(key) || (level > 0 ? meanSize(layer, level - 1) : 0);
};
const CLOUD_BYTES = BODY.clouds ? statSync(join(import.meta.dirname, '../../public', BODY.clouds.staticUrl.replace(/\.json$/, '.avif'))).size : 0;

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

function run(shot, { tiltDeg, maxTexelPx, relaxBeyondKm }) {
  const fetched = LAYERS.map(() => new Set());
  // The shadow map counts as height.
  const bytes = LAYERS.map((l) => (l.id === 'height' ? size(SHADOW_MAP.path) : 0));
  let missing = 0;
  let estimated = 0;
  let unestimated = 0;
  let firstView = 0;
  let peakTiles = 0;
  for (let t = 0; t <= SECONDS; t += 1) {
    const date = new Date(shot.orbit.epoch.getTime() + t * 1000);
    const s = sample(shot.orbit, date);
    const f = bodyFrame(BODY, date);
    const vBody = [vec.dot(s.v, f.x), vec.dot(s.v, f.y), vec.dot(s.v, f.z)];
    const pose = orbitCameraPose(s.rBody, vBody, meta.radiusKm, tiltDeg);
    const view = { fovYRad: (FOV * Math.PI) / 180, aspect: ASPECT, viewportHeightPx: HEIGHT_PX };
    const opts = { radiusKm: meta.radiusKm, heightRangeKm, tilePx: TILES.colorPx, maxLevel: MAX_LEVEL, maxTexelPx, relaxBeyondKm };
    const selected = selectTiles({ ...pose, ...view }, opts);
    peakTiles = Math.max(peakTiles, selected.length);
    const ahead = [];
    if (t > 0 && LOOKAHEAD > 0) {
      const at = new Date(date.getTime() + LOOKAHEAD * 1000);
      const sa = sample(shot.orbit, at);
      const fa = bodyFrame(BODY, at);
      const va = [vec.dot(sa.v, fa.x), vec.dot(sa.v, fa.y), vec.dot(sa.v, fa.z)];
      ahead.push(...selectTiles({ ...orbitCameraPose(sa.rBody, va, meta.radiusKm, tiltDeg), ...view }, opts));
    }
    // The first view is fetched lean, as the renderer does before its first fade-in.
    LAYERS.forEach((layer, i) => {
      const keys = [...layerTilesFor(selected, layer, { lean: t === 0, sunDir: s.sunBody, flatOcean: meta.flatOcean }), ...(ahead.length ? layerTilesFor(ahead, layer, { sunDir: s.sunBody, flatOcean: meta.flatOcean }) : [])];
      for (const k of keys) {
        const id = tileId(k);
        if (fetched[i].has(id)) continue;
        fetched[i].add(id);
        const b = size(layerPath(layer, k));
        if (Number.isNaN(b)) {
          missing++;
          const mean = meanSize(layer, k.level);
          estimated += mean;
          if (!mean) unestimated++;
        } else bytes[i] += b;
      }
    });
    if (t === 0) firstView = bytes.reduce((a, b) => a + b, 0) + estimated + CLOUD_BYTES;
  }
  return { firstView, total: bytes.reduce((a, b) => a + b, 0) + estimated + CLOUD_BYTES, bytes, peakTiles, missing, estimated, unestimated };
}

const now = new Date();
const shots = [];
for (let i = 0; i < SHOTS; i++) {
  const at = new Date(now.getTime() + i * 2.1 * 3600e3);
  const opts = { body: BODY, rand: () => (i * 0.618) % 1 };
  shots.push(i % 3 === 0 ? dawnDusk(at, opts) : i % 3 === 1 ? orbitalSunrise(at, opts) : featureFlyover(at, opts) ?? dawnDusk(at, opts));
}

const MB = (b) => (b / 1e6).toFixed(1);
console.log(`viewport ${Math.round(HEIGHT_PX * ASPECT)}×${HEIGHT_PX}, ${SHOTS} shots, ${SECONDS} s of orbit each\n`);
const rows = [];
let unestimatedTiles = 0;
for (const tiltDeg of [12, 15, 18, 25, 35]) {
  for (const [maxTexelPx, relaxBeyondKm] of [[1, Infinity], [1.5, Infinity], [2, Infinity], [1, 500], [1, 300]]) {
    const runs = shots.map((s) => run(s, { tiltDeg, maxTexelPx, relaxBeyondKm }));
    unestimatedTiles += runs.reduce((a, r) => a + r.unestimated, 0);
    const avg = (k) => runs.reduce((a, r) => a + r[k], 0) / runs.length;
    rows.push({
      tilt: `${tiltDeg}°`,
      'texel ≤ px': maxTexelPx,
      'relax beyond km': relaxBeyondKm === Infinity ? '-' : relaxBeyondKm,
      'first view MB': MB(avg('firstView')),
      [`${SECONDS} s MB`]: MB(avg('total')),
      ...Object.fromEntries(LAYERS.map((l, i) => [`${LABELS[l.id] ?? l.id} MB`, MB(runs.reduce((a, r) => a + r.bytes[i], 0) / runs.length)])),
      ...(CLOUD_BYTES ? { 'clouds MB': MB(CLOUD_BYTES) } : {}),
      ...(runs.some((r) => r.missing) ? { 'estimated MB': MB(avg('estimated')) } : {}),
      [`worst ${SECONDS} s MB`]: MB(Math.max(...runs.map((r) => r.total))),
      'peak tiles drawn': Math.round(avg('peakTiles')),
      missing: Math.round(avg('missing')),
    });
  }
}
console.table(rows);
if (unestimatedTiles) console.warn(`${unestimatedTiles} missing tiles belong to a layer with no baked tiles at all and count as 0 bytes.`);
