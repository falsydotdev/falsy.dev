// Cuts Viking colour tiles. Each worker takes one level-3 tile, reads its window of the
// mosaic, samples the level-7 tiles beneath it, and builds every parent by 2×2 averaging.
// The main thread then builds levels 0 to 2 from the level-3 results.
//   node scripts/tiles/colour.mjs                 whole planet
//   node scripts/tiles/colour.mjs --near 18.65,226.2,800   only level-3 tiles within 800 km
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { open, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { availableParallelism } from 'node:os';
import { createRequire } from 'node:module';
import { fromFile } from 'geotiff';
import { SOURCES, TILE_DIR } from './paths.mjs';
import { children, dirOf, tileDir, tileLatLonBounds, tileId } from '../../src/scene/tiles/cube.ts';
import { TILES, colorPath } from '../../src/scene/tiles/layout.ts';

const sharp = createRequire(import.meta.url)('sharp');
const OUT = join(TILE_DIR, 'mars');
const JOB_LEVEL = 3;
const PX = TILES.colorPx;
const QUALITY = 60;
const RADIUS_KM = 3396.19;

async function encode(rgb, k) {
  const file = join(OUT, colorPath(k));
  await mkdir(dirname(file), { recursive: true });
  await sharp(rgb, { raw: { width: PX, height: PX, channels: 3 } }).avif({ quality: QUALITY, effort: 4 }).toFile(file);
}

/** Averages four child tiles (ordered as `children()` returns them) into their parent. */
function downsample(kids) {
  const out = Buffer.alloc(PX * PX * 3);
  const half = PX / 2;
  kids.forEach((rgb, i) => {
    const ox = (i & 1) * half;
    const oy = (i >> 1) * half;
    for (let y = 0; y < half; y++) {
      for (let x = 0; x < half; x++) {
        const a = (2 * y * PX + 2 * x) * 3;
        const b = a + PX * 3;
        const o = ((oy + y) * PX + ox + x) * 3;
        for (let c = 0; c < 3; c++) out[o + c] = (rgb[a + c] + rgb[a + 3 + c] + rgb[b + c] + rgb[b + 3 + c] + 2) >> 2;
      }
    }
  });
  return out;
}

async function openViking() {
  const tiff = await fromFile(SOURCES.viking.file);
  const img = await tiff.getImage(0);
  const offsets = await img.fileDirectory.loadValue('StripOffsets');
  return { w: img.getWidth(), h: img.getHeight(), base: offsets[0] };
}

// Planar layout with one row per strip, bands back to back: band b, row r starts at base + (b·h + r)·w.
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

async function build(win, src, k) {
  const rgb = k.level === TILES.maxLevel ? cutLeaf(win, src, k) : downsample(await Promise.all(children(k).map((c) => build(win, src, c))));
  await encode(rgb, k);
  return rgb;
}

async function work() {
  sharp.concurrency(1);
  const src = await openViking();
  const fh = await open(SOURCES.viking.file, 'r');
  parentPort.on('message', async (k) => {
    const win = await readWindow(fh, src, k);
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
  for (const k of jobs) if (!queue.includes(k)) results.set(tileId(k), await sharp(join(OUT, colorPath(k))).removeAlpha().raw().toBuffer());
  console.log(`${queue.length} of ${jobs.length} level-${JOB_LEVEL} jobs to cut`);

  const workers = Math.min(queue.length, Math.max(1, availableParallelism() - 2));
  await Promise.all(
    Array.from({ length: workers }, () => new Promise((resolve, reject) => {
      const worker = new Worker(new URL(import.meta.url));
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
