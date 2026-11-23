// Cuts colour tiles from a body's global colour mosaic. Each worker takes one level-3 tile, reads
// its window of the mosaic, samples the level-7 tiles beneath it, and builds every parent by 2×2
// averaging. The main thread then builds levels 0 to 2 from the level-3 results. Earth reads the
// mosaic step's rasters (finest covering raster per sample) and puts the water mask in alpha.
//   node scripts/tiles/colour.mjs [--body mars|moon|earth]          whole body
//   node scripts/tiles/colour.mjs --near 18.65,226.2,800   only level-3 tiles within 800 km
//   node scripts/tiles/colour.mjs --leaf-level 3           cut leaves at level 3 (a quick preview)
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { open, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { availableParallelism } from 'node:os';
import { createRequire } from 'node:module';
import { SOURCES, TILE_DIR, PIPELINE, bodyArg, bodyInfo } from './paths.mjs';
import { covers, isGlobal, listRasters } from './mosaic-rasters.mjs';
import { QUALITY, encodeTile } from './colour-encode.mjs';
import { leafLevelArg } from './leaf-level.ts';
import { children, dirOf, tileDir, tileLatLonBounds, tileId } from '../../src/scene/tiles/cube.ts';
import { TILES, colorPath } from '../../src/scene/tiles/layout.ts';

const sharp = createRequire(import.meta.url)('sharp');
const BODY = isMainThread ? bodyArg() : workerData.body;
const SPEC = PIPELINE[BODY].colour;
const OUT = join(TILE_DIR, BODY);
const JOB_LEVEL = 3;
const PX = TILES.colorPx;
const INFO = bodyInfo(BODY);
const LAYER = INFO.layers.find((l) => l.id === 'color');
const RADIUS_KM = INFO.radiusKm;
const MOSAIC = SPEC.format === 'mosaic';
// Masked layers carry the water mask in alpha: 255 is land, 0 is water.
const CHANNELS = LAYER.format === 'masked' ? 4 : 3;
// Worker threads don't see the command line, so the main thread hands its value over.
const LEAF_LEVEL = isMainThread ? leafLevelArg(process.argv, { min: JOB_LEVEL, max: LAYER.maxLevel }) : workerData.leafLevel;

async function encode(rgb, k) {
  const file = join(OUT, colorPath(k));
  await mkdir(dirname(file), { recursive: true });
  await encodeTile(rgb, CHANNELS).toFile(file);
}

/** Averages four child tiles (ordered as `children()` returns them) into their parent. */
function downsample(kids) {
  const n = CHANNELS;
  const out = Buffer.alloc(PX * PX * n);
  const half = PX / 2;
  kids.forEach((rgb, i) => {
    const ox = (i & 1) * half;
    const oy = (i >> 1) * half;
    for (let y = 0; y < half; y++) {
      for (let x = 0; x < half; x++) {
        const a = (2 * y * PX + 2 * x) * n;
        const b = a + PX * n;
        const o = ((oy + y) * PX + ox + x) * n;
        for (let c = 0; c < n; c++) out[o + c] = (rgb[a + c] + rgb[a + n + c] + rgb[b + c] + rgb[b + n + c] + 2) >> 2;
      }
    }
  });
  return out;
}

// Workers read a window of 8-bit planar bands straight from disk: band b, row r starts at
// base + (b·h + r)·w. A mosaic already laid out that way is read in place; any other TIFF is
// decoded once into that layout beside the source.
async function openSource() {
  if (MOSAIC) {
    const colour = listRasters('colour');
    if (!colour.some(isGlobal)) throw new Error('No global colour raster: run scripts/tiles/earth-mosaic.mjs first');
    return { colour, mask: CHANNELS === 4 ? listRasters('mask') : [] };
  }
  const file = SOURCES[SPEC.source].file;
  if (SPEC.format === 'decode') return decodeToPlanar(file);
  // geotiff loads the web-worker package, which hijacks any worker thread that imports it,
  // so only the main thread reads the TIFF header.
  const { fromFile } = await import('geotiff');
  const tiff = await fromFile(file);
  const img = await tiff.getImage(0);
  const offsets = await img.fileDirectory.loadValue('StripOffsets');
  return { file, w: img.getWidth(), h: img.getHeight(), base: offsets[0] };
}

async function decodeToPlanar(file) {
  const out = `${file}.planar`;
  const img = sharp(file, { limitInputPixels: false, unlimited: true });
  const { width: w, height: h } = await img.metadata();
  if (existsSync(out) && statSync(out).size === w * h * 3) return { file: out, w, h, base: 0 };
  const t0 = Date.now();
  // toColourspace converts 16-bit sRGB to 8-bit by scaling rather than clipping.
  const rgb = await img.removeAlpha().toColourspace('srgb').raw().toBuffer();
  if (rgb.length !== w * h * 3) throw new Error(`decoded ${rgb.length} bytes, expected ${w * h * 3}`);
  const planar = Buffer.alloc(rgb.length);
  const n = w * h;
  for (let i = 0; i < n; i++) {
    planar[i] = rgb[3 * i];
    planar[n + i] = rgb[3 * i + 1];
    planar[2 * n + i] = rgb[3 * i + 2];
  }
  await writeFile(out, planar);
  console.log(`decoded ${w}×${h} to ${out} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  return { file: out, w, h, base: 0 };
}

async function readWindow(fh, src, k) {
  const b = tileLatLonBounds(k);
  const r0 = Math.max(0, Math.floor(((90 - b.latMax) / 180) * src.h) - 2);
  const r1 = Math.min(src.h, Math.ceil(((90 - b.latMin) / 180) * src.h) + 2);
  let c0 = Math.floor(((b.lonMin + 180) / 360) * src.w) - 2;
  let cols = Math.ceil(((b.lonMax + 180) / 360) * src.w) + 2 - c0;
  if (cols >= src.w) [c0, cols] = [0, src.w];
  c0 = ((c0 % src.w) + src.w) % src.w;
  const rows = r1 - r0;
  const planes = [0, 1, 2].map(() => Buffer.alloc(rows * cols));
  const firstLen = Math.min(cols, src.w - c0);
  for (let band = 0; band < 3; band++) {
    for (let r = 0; r < rows; r++) {
      const rowStart = src.base + (band * src.h + r0 + r) * src.w;
      await fh.read(planes[band], r * cols, firstLen, rowStart + c0);
      if (firstLen < cols) await fh.read(planes[band], r * cols + firstLen, cols - firstLen, rowStart);
    }
  }
  return { r0, rows, c0, cols, planes };
}

function cutLeaf(win, src, k) {
  const out = Buffer.alloc(PX * PX * 3);
  const { planes, cols, rows } = win;
  const acc = [0, 0, 0];
  const add = (lat, lon) => {
    let fx = ((lon + 180) / 360) * src.w - 0.5 - win.c0;
    if (fx < -2) fx += src.w;
    else if (fx > cols + 1) fx -= src.w;
    const fy = ((90 - lat) / 180) * src.h - 0.5 - win.r0;
    const x0 = Math.max(0, Math.min(cols - 2, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(rows - 2, Math.floor(fy)));
    const tx = Math.max(0, Math.min(1, fx - x0));
    const ty = Math.max(0, Math.min(1, fy - y0));
    const i = y0 * cols + x0;
    for (let c = 0; c < 3; c++) {
      const p = planes[c];
      acc[c] += (p[i] * (1 - tx) + p[i + 1] * tx) * (1 - ty) + (p[i + cols] * (1 - tx) + p[i + cols + 1] * tx) * ty;
    }
  };
  // 2×2 supersampling per texel, mainly for high latitudes where source columns are narrow.
  for (let y = 0; y < PX; y++) {
    for (let x = 0; x < PX; x++) {
      acc[0] = acc[1] = acc[2] = 0;
      for (const [sx, sy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        const d = tileDir(k, (x + sx) / PX, (y + sy) / PX);
        add((Math.asin(d[2]) * 180) / Math.PI, (Math.atan2(d[1], d[0]) * 180) / Math.PI);
      }
      const o = (y * PX + x) * 3;
      for (let c = 0; c < 3; c++) out[o + c] = Math.round(acc[c] / 4);
    }
  }
  return out;
}

// A window of each mosaic raster that overlaps the tile, with a two-pixel margin. Global rasters
// wrap in longitude as the single-file path does.
async function readRasterWindow(fh, r, b) {
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
  const planes = Array.from({ length: r.bands }, () => Buffer.alloc(rows * cols));
  const firstLen = Math.min(cols, r.w - c0);
  for (let band = 0; band < r.bands; band++) {
    for (let y = 0; y < rows; y++) {
      const rowStart = (band * r.h + r0 + y) * r.w;
      await fh.read(planes[band], y * cols, firstLen, rowStart + c0);
      if (firstLen < cols) await fh.read(planes[band], y * cols + firstLen, cols - firstLen, rowStart);
    }
  }
  return { r, wrap, r0, rows, c0, cols, planes };
}

/** Bilinear sample of every band of a raster window into acc. */
function addFrom(win, lat, lon, acc, offset) {
  const { r, planes, cols, rows } = win;
  let fx = ((lon - r.west) / (r.east - r.west)) * r.w - 0.5 - win.c0;
  if (win.wrap && fx < -2) fx += r.w;
  else if (win.wrap && fx > cols + 1) fx -= r.w;
  const fy = ((r.north - lat) / (r.north - r.south)) * r.h - 0.5 - win.r0;
  const x0 = Math.max(0, Math.min(cols - 2, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(rows - 2, Math.floor(fy)));
  const tx = Math.max(0, Math.min(1, fx - x0));
  const ty = Math.max(0, Math.min(1, fy - y0));
  const i = y0 * cols + x0;
  planes.forEach((p, c) => {
    acc[offset + c] += (p[i] * (1 - tx) + p[i + 1] * tx) * (1 - ty) + (p[i + cols] * (1 - tx) + p[i + cols + 1] * tx) * ty;
  });
}

function cutMosaicLeaf(wins, k) {
  const out = Buffer.alloc(PX * PX * CHANNELS);
  const acc = new Float64Array(4);
  const pick = (list, lat, lon) => list.find((w) => covers(w.r, lat, lon)) ?? list[list.length - 1];
  for (let y = 0; y < PX; y++) {
    for (let x = 0; x < PX; x++) {
      acc.fill(0);
      for (const [sx, sy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        const d = tileDir(k, (x + sx) / PX, (y + sy) / PX);
        const lat = (Math.asin(d[2]) * 180) / Math.PI;
        const lon = (Math.atan2(d[1], d[0]) * 180) / Math.PI;
        addFrom(pick(wins.colour, lat, lon), lat, lon, acc, 0);
        if (CHANNELS === 4) addFrom(pick(wins.mask, lat, lon), lat, lon, acc, 3);
      }
      const o = (y * PX + x) * CHANNELS;
      for (let c = 0; c < CHANNELS; c++) out[o + c] = Math.round(acc[c] / 4);
    }
  }
  return out;
}

async function build(win, src, k) {
  const leaf = k.level === LEAF_LEVEL;
  const rgb = leaf ? (MOSAIC ? cutMosaicLeaf(win, k) : cutLeaf(win, src, k)) : downsample(await Promise.all(children(k).map((c) => build(win, src, c))));
  await encode(rgb, k);
  return rgb;
}

async function work() {
  sharp.concurrency(1);
  const src = workerData.src;
  const handles = new Map();
  const fileOf = async (file) => handles.get(file) ?? handles.set(file, await open(file, 'r')).get(file);
  const fh = MOSAIC ? null : await open(src.file, 'r');
  const mosaicWindows = async (k) => {
    const b = tileLatLonBounds(k);
    const read = async (list) => (await Promise.all(list.map(async (r) => readRasterWindow(await fileOf(r.file), r, b)))).filter(Boolean);
    return { colour: await read(src.colour), mask: await read(src.mask) };
  };
  parentPort.on('message', async (k) => {
    const win = MOSAIC ? await mosaicWindows(k) : await readWindow(fh, src, k);
    const rgb = await build(win, src, k);
    parentPort.postMessage({ id: tileId(k), rgb });
  });
  parentPort.postMessage({ ready: true });
}

async function main() {
  const t0 = Date.now();
  const nearArg = process.argv.indexOf('--near');
  const near = nearArg > 0 ? process.argv[nearArg + 1].split(',').map(Number) : null;
  const n = 2 ** JOB_LEVEL;
  let jobs = [];
  for (let face = 0; face < 6; face++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) jobs.push({ face, level: JOB_LEVEL, x, y });
  if (near) {
    const [lat, lon, km] = near;
    const p = dirOf(lat, lon);
    jobs = jobs.filter((k) => {
      const c = tileDir(k, 0.5, 0.5);
      return Math.acos(Math.min(1, p[0] * c[0] + p[1] * c[1] + p[2] * c[2])) * RADIUS_KM < km;
    });
  }
  const results = new Map();
  const queue = jobs.filter((k) => !existsSync(join(OUT, colorPath(k))));
  for (const k of jobs) {
    if (queue.includes(k)) continue;
    const img = sharp(join(OUT, colorPath(k)));
    results.set(tileId(k), await (CHANNELS === 4 ? img.ensureAlpha() : img.removeAlpha()).raw().toBuffer());
  }
  console.log(`${queue.length} of ${jobs.length} level-${JOB_LEVEL} jobs to cut`);

  const src = await openSource();
  const workers = Math.min(queue.length, Math.max(1, availableParallelism() - 2));
  await Promise.all(
    Array.from({ length: workers }, () => new Promise((resolve, reject) => {
      const worker = new Worker(new URL(import.meta.url), { workerData: { body: BODY, src, leafLevel: LEAF_LEVEL } });
      const next = () => {
        const k = queue.shift();
        if (k) worker.postMessage(k);
        else worker.terminate().then(resolve);
      };
      worker.on('message', (m) => {
        if (!m.ready) {
          results.set(m.id, Buffer.from(m.rgb));
          process.stdout.write(`  ${results.size}/${jobs.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`);
        }
        next();
      });
      worker.on('error', reject);
    })),
  );

  if (results.size === 6 * n * n) {
    const up = async (k) => {
      const rgb = k.level === JOB_LEVEL ? results.get(tileId(k)) : downsample(await Promise.all(children(k).map(up)));
      if (k.level < JOB_LEVEL) await encode(rgb, k);
      return rgb;
    };
    for (let face = 0; face < 6; face++) await up({ face, level: 0, x: 0, y: 0 });
  } else {
    console.log('Partial cut: skipped levels 0 to 2');
  }
  const metaFile = join(OUT, 'meta.json');
  const meta = await readFile(metaFile, 'utf8').then(JSON.parse).catch(() => ({}));
  await writeFile(metaFile, JSON.stringify({ ...meta, colorFormat: 'avif', colorQuality: QUALITY }, null, 2));
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

if (isMainThread) await main();
else await work();
