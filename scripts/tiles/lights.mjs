// Cuts the city-lights layer from the mosaic step's lights rasters (finest covering raster per
// sample). Light is sampled and averaged in linear units and stored as display grey (see
// src/scene/tiles/lights-codec.ts). Levels 0 to 2 are built once every level-3 tile exists.
//   node scripts/tiles/lights.mjs --body earth                          whole body
//   node scripts/tiles/lights.mjs --body earth --near 52.3,5.3,500      only level-3 tiles within 500 km
//   node scripts/tiles/lights.mjs --body earth --leaf-level 3           cut leaves at level 3
import { open, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { TILE_DIR, bodyArg, bodyInfo } from './paths.mjs';
import { covers, isGlobal, listRasters } from './mosaic-rasters.mjs';
import { leafLevelArg } from './leaf-level.ts';
import { children, dirOf, tileDir, tileLatLonBounds, tileId } from '../../src/scene/tiles/cube.ts';
import { layerPath } from '../../src/scene/tiles/layers.ts';
import { greyOf, lightOf } from '../../src/scene/tiles/lights-codec.ts';

const sharp = createRequire(import.meta.url)('sharp');
// Higher than colour's 60: lights are sparse points on black, which lower settings smear.
export const LIGHTS_QUALITY = 75;
const JOB_LEVEL = 3;
const BODY = bodyArg();
const INFO = bodyInfo(BODY);
const LAYER = INFO.layers.find((l) => l.id === 'lights');
if (!LAYER) throw new Error(`${BODY} has no lights layer`);
const PX = LAYER.sizePx;
const OUT = join(TILE_DIR, BODY);
const LEAF_LEVEL = leafLevelArg(process.argv, { min: JOB_LEVEL, max: LAYER.maxLevel });

const fileOf = (k) => join(OUT, layerPath(LAYER, k));

async function encode(light, k) {
  const grey = Buffer.alloc(PX * PX);
  for (let i = 0; i < grey.length; i++) grey[i] = greyOf(light[i]);
  await mkdir(dirname(fileOf(k)), { recursive: true });
  await sharp(grey, { raw: { width: PX, height: PX, channels: 1 } }).avif({ quality: LIGHTS_QUALITY, effort: 4 }).toFile(fileOf(k));
}

async function decode(k) {
  const grey = await sharp(fileOf(k)).extractChannel(0).raw().toBuffer();
  return Float32Array.from(grey, lightOf);
}

/** A window of raster `r` over bounds `b`, two pixels of margin, as light. Global rasters wrap in longitude. */
async function readWindow(fh, r, b) {
  const wrap = isGlobal(r);
  const sx = r.w / (r.east - r.west);
  const sy = r.h / (r.north - r.south);
  const r0 = Math.max(0, Math.floor((r.north - b.latMax) * sy) - 2);
  const r1 = Math.min(r.h, Math.ceil((r.north - b.latMin) * sy) + 2);
  let c0 = Math.floor((b.lonMin - r.west) * sx) - 2;
  let c1 = Math.ceil((b.lonMax - r.west) * sx) + 2;
  if (!wrap) [c0, c1] = [Math.max(0, c0), Math.min(r.w, c1)];
  let cols = c1 - c0;
  if (r1 - r0 < 2 || cols < 2) return null;
  if (cols >= r.w) [c0, cols] = [0, r.w];
  c0 = ((c0 % r.w) + r.w) % r.w;
  const rows = r1 - r0;
  const grey = Buffer.alloc(rows * cols);
  const firstLen = Math.min(cols, r.w - c0);
  for (let y = 0; y < rows; y++) {
    await fh.read(grey, y * cols, firstLen, (r0 + y) * r.w + c0);
    if (firstLen < cols) await fh.read(grey, y * cols + firstLen, cols - firstLen, (r0 + y) * r.w);
  }
  return { r, wrap, r0, rows, c0, cols, light: Float32Array.from(grey, lightOf) };
}

function sampleAt(win, lat, lon) {
  const { r, light, cols, rows } = win;
  let fx = ((lon - r.west) / (r.east - r.west)) * r.w - 0.5 - win.c0;
  if (win.wrap && fx < -2) fx += r.w;
  else if (win.wrap && fx > cols + 1) fx -= r.w;
  const fy = ((r.north - lat) / (r.north - r.south)) * r.h - 0.5 - win.r0;
  const x0 = Math.max(0, Math.min(cols - 2, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(rows - 2, Math.floor(fy)));
  const tx = Math.max(0, Math.min(1, fx - x0));
  const ty = Math.max(0, Math.min(1, fy - y0));
  const i = y0 * cols + x0;
  return (light[i] * (1 - tx) + light[i + 1] * tx) * (1 - ty) + (light[i + cols] * (1 - tx) + light[i + cols + 1] * tx) * ty;
}

function cutLeaf(wins, k) {
  const out = new Float32Array(PX * PX);
  for (let y = 0; y < PX; y++) {
    for (let x = 0; x < PX; x++) {
      let acc = 0;
      // 2×2 supersampling per texel, mainly for high latitudes where source columns are narrow.
      for (const [sx, sy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        const d = tileDir(k, (x + sx) / PX, (y + sy) / PX);
        const lat = (Math.asin(d[2]) * 180) / Math.PI;
        const lon = (Math.atan2(d[1], d[0]) * 180) / Math.PI;
        acc += sampleAt(wins.find((w) => covers(w.r, lat, lon)) ?? wins[wins.length - 1], lat, lon);
      }
      out[y * PX + x] = acc / 4;
    }
  }
  return out;
}

/** Averages four child tiles (ordered as `children()` returns them) into their parent, in light. */
function downsample(kids) {
  const out = new Float32Array(PX * PX);
  const half = PX / 2;
  kids.forEach((c, i) => {
    const ox = (i & 1) * half;
    const oy = (i >> 1) * half;
    for (let y = 0; y < half; y++) {
      for (let x = 0; x < half; x++) {
        const a = 2 * y * PX + 2 * x;
        out[(oy + y) * PX + ox + x] = (c[a] + c[a + 1] + c[a + PX] + c[a + PX + 1]) / 4;
      }
    }
  });
  return out;
}

async function build(wins, k) {
  const light = k.level === LEAF_LEVEL ? cutLeaf(wins, k) : downsample(await Promise.all(children(k).map((c) => build(wins, c))));
  await encode(light, k);
  return light;
}

const t0 = Date.now();
const rasters = listRasters('lights');
if (!rasters.some(isGlobal)) throw new Error('No global lights raster: run scripts/tiles/earth-mosaic.mjs --coarse lights (or the full mosaic) first');
const handles = new Map(await Promise.all(rasters.map(async (r) => [r.file, await open(r.file, 'r')])));

const nearArg = process.argv.indexOf('--near');
const n = 2 ** JOB_LEVEL;
let jobs = [];
for (let face = 0; face < 6; face++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) jobs.push({ face, level: JOB_LEVEL, x, y });
if (nearArg > 0) {
  const [lat, lon, km] = process.argv[nearArg + 1].split(',').map(Number);
  const p = dirOf(lat, lon);
  jobs = jobs.filter((k) => {
    const c = tileDir(k, 0.5, 0.5);
    return Math.acos(Math.min(1, p[0] * c[0] + p[1] * c[1] + p[2] * c[2])) * INFO.radiusKm < km;
  });
}
const results = new Map();
const queue = jobs.filter((k) => !existsSync(fileOf(k)));
for (const k of jobs) if (!queue.includes(k)) results.set(tileId(k), await decode(k));
console.log(`${queue.length} of ${jobs.length} level-${JOB_LEVEL} jobs to cut`);
for (const k of queue) {
  const b = tileLatLonBounds(k);
  const wins = (await Promise.all(rasters.map((r) => readWindow(handles.get(r.file), r, b)))).filter(Boolean);
  results.set(tileId(k), await build(wins, k));
  process.stdout.write(`  ${results.size}/${jobs.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`);
}

if (results.size === 6 * n * n) {
  const up = async (k) => {
    const light = k.level === JOB_LEVEL ? results.get(tileId(k)) : downsample(await Promise.all(children(k).map(up)));
    if (k.level < JOB_LEVEL) await encode(light, k);
    return light;
  };
  for (let face = 0; face < 6; face++) await up({ face, level: 0, x: 0, y: 0 });
} else {
  console.log('Partial cut: skipped levels 0 to 2');
}
for (const fh of handles.values()) await fh.close();
const metaFile = join(OUT, 'meta.json');
const meta = await readFile(metaFile, 'utf8').then(JSON.parse).catch(() => ({}));
await writeFile(metaFile, JSON.stringify({ ...meta, lightsFormat: 'avif', lightsQuality: LIGHTS_QUALITY }, null, 2));
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
