// Cuts height tiles for every level from a body's global height mosaic. The whole mosaic
// (about 2 GB) and its box-filtered mips sit in shared memory, so workers sample any tile with
// plain bilinear lookups. Earth reads the mosaic step's rasters instead (finest covering raster
// per sample), and records which tiles are open ocean in meta.json's flat-ocean bitmap.
//   node scripts/tiles/heights.mjs [--body mars|moon|earth] [--shadow-only]
//   node scripts/tiles/heights.mjs --near 52.3,5.3,500   levels 0–3, and deeper only under level-3 tiles within 500 km
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { open, mkdir, writeFile, readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { availableParallelism } from 'node:os';
import { SOURCES, TILE_DIR, PIPELINE, bodyArg, bodyInfo } from './paths.mjs';
import { BYTES, covers, isGlobal, listRasters, pixelM } from './mosaic-rasters.mjs';
import { dirOf, parent, tileDir, tileEdgeKm, tileId } from '../../src/scene/tiles/cube.ts';
import { TILES, HEIGHT_SIZE, SHADOW_MAP, heightPath, heightSampleFraction, encodeHeights } from '../../src/scene/tiles/layout.ts';
import { FlatOceanBuilder } from '../../src/scene/tiles/flat-ocean.ts';

const BODY = isMainThread ? bodyArg() : workerData.body;
const SPEC = PIPELINE[BODY].heights;
const NODATA = SPEC.nodata;
const INFO = bodyInfo(BODY);
const RADIUS_KM = INFO.radiusKm;
const MAX_LEVEL = INFO.layers.find((l) => l.id === 'height').maxLevel;
const SOURCE_M = SPEC.pixelM;
const OUT = join(TILE_DIR, BODY);
const MOSAIC = SPEC.format === 'mosaic';
const NEAR_LEVEL = 3;

// Every loader returns heights in whole metres as int16, gridded from 180°W and 90°N.
const loadHeights = () => (SPEC.format === 'pds-int16' ? loadPds() : loadGeotiff());

/** Mosaic rasters of `kind` read whole into shared memory, finest first. */
async function loadRasters(kind) {
  return Promise.all(listRasters(kind).map(async (r) => {
    const sab = new SharedArrayBuffer(r.w * r.h * BYTES[r.type]);
    const bytes = new Uint8Array(sab);
    const fh = await open(r.file, 'r');
    for (let pos = 0; pos < bytes.length; ) {
      const { bytesRead } = await fh.read(bytes, pos, Math.min(1 << 30, bytes.length - pos), pos);
      if (!bytesRead) throw new Error(`short read in ${r.file}`);
      pos += bytesRead;
    }
    await fh.close();
    return { ...r, sab };
  }));
}

async function loadGeotiff() {
  // Main thread only: geotiff's web-worker dependency hijacks worker threads that import it.
  const { fromFile } = await import('geotiff');
  const file = SOURCES[SPEC.source].file;
  const tiff = await fromFile(file);
  const img = await tiff.getImage(0);
  const [w, h] = [img.getWidth(), img.getHeight()];
  const offsets = await img.fileDirectory.loadValue('StripOffsets');
  const sab = new SharedArrayBuffer(w * h * 2);
  const data = new Int16Array(sab);
  const fh = await open(file, 'r');
  const bytes = new Uint8Array(sab);
  // Strips are one row each and stored back to back, so the raster is one contiguous read.
  for (let pos = 0; pos < bytes.length; ) {
    const { bytesRead } = await fh.read(bytes, pos, Math.min(1 << 30, bytes.length - pos), offsets[0] + pos);
    if (!bytesRead) throw new Error('short read');
    pos += bytesRead;
  }
  await fh.close();
  let filled = 0;
  for (let y = 0; y < h; y++) {
    let last = NODATA;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (data[i] === NODATA) {
        data[i] = last === NODATA ? (y > 0 ? data[i - w] : 0) : last;
        filled++;
      } else last = data[i];
    }
  }
  return { w, h, sab, filled };
}

// A PDS raw image with a detached label: little-endian int16 samples, DN × SCALING_FACTOR metres
// above the reference sphere.
async function loadPds() {
  const label = await readFile(SOURCES[SPEC.label].file, 'utf8');
  const field = (name) => {
    const m = label.match(new RegExp(`^\\s*${name}\\s*=\\s*"?([^\\s"<]+)`, 'm'));
    if (!m) throw new Error(`${name} missing from the label`);
    return m[1];
  };
  if (field('SAMPLE_TYPE') !== 'LSB_INTEGER' || field('SAMPLE_BITS') !== '16') throw new Error('expected little-endian int16 samples');
  const w = Number(field('LINE_SAMPLES'));
  const h = Number(field('LINES'));
  const scale = Number(field('SCALING_FACTOR'));
  const west = Number(field('WESTERNMOST_LONGITUDE'));
  const sab = new SharedArrayBuffer(w * h * 2);
  const bytes = new Uint8Array(sab);
  const fh = await open(SOURCES[SPEC.source].file, 'r');
  for (let pos = 0; pos < bytes.length; ) {
    const { bytesRead } = await fh.read(bytes, pos, Math.min(1 << 30, bytes.length - pos), pos);
    if (!bytesRead) throw new Error('short read');
    pos += bytesRead;
  }
  await fh.close();
  const data = new Int16Array(sab);
  for (let i = 0; i < data.length; i++) data[i] = Math.round(data[i] * scale);
  // Columns that start at 0°E are rotated half a turn, so column 0 sits at 180°W like every other source.
  if (Math.round(((west % 360) + 360) % 360) === 0) {
    const half = w / 2;
    const tmp = new Int16Array(half);
    for (let y = 0; y < h; y++) {
      const row = data.subarray(y * w, (y + 1) * w);
      tmp.set(row.subarray(0, half));
      row.copyWithin(0, half);
      row.set(tmp, half);
    }
  }
  return { w, h, sab, filled: 0 };
}

function buildMips(base) {
  const mips = [base];
  while (mips.length < 8) {
    const prev = mips[mips.length - 1];
    const src = new Int16Array(prev.sab);
    const w = prev.w >> 1;
    const h = prev.h >> 1;
    const sab = new SharedArrayBuffer(w * h * 2);
    const dst = new Int16Array(sab);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const a = 2 * y * prev.w + 2 * x;
        dst[y * w + x] = Math.round((src[a] + src[a + 1] + src[a + prev.w] + src[a + prev.w + 1]) / 4);
      }
    }
    mips.push({ w, h, sab });
  }
  return mips.map(({ w, h, sab }) => ({ w, h, sab }));
}

function allTiles() {
  const nearArg = process.argv.indexOf('--near');
  const near = nearArg > 0 ? process.argv[nearArg + 1].split(',').map(Number) : null;
  const p = near && dirOf(near[0], near[1]);
  const isNear = (k) => {
    while (k.level > NEAR_LEVEL) k = parent(k);
    const c = tileDir(k, 0.5, 0.5);
    return Math.acos(Math.min(1, p[0] * c[0] + p[1] * c[1] + p[2] * c[2])) * RADIUS_KM < near[2];
  };
  const tiles = [];
  for (let level = 0; level <= MAX_LEVEL; level++) {
    const n = 2 ** level;
    for (let face = 0; face < 6; face++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const k = { face, level, x, y };
      if (!near || level <= NEAR_LEVEL || isNear(k)) tiles.push(k);
    }
  }
  return tiles;
}

async function writeShadowMap(base) {
  const { width: w, height: h, path } = SHADOW_MAP;
  const src = new Int16Array(base.sab);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * base.h) / h);
    const y1 = Math.floor(((y + 1) * base.h) / h);
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * base.w) / w);
      const x1 = Math.floor(((x + 1) * base.w) / w);
      let sum = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) sum += src[yy * base.w + xx];
      out[y * w + x] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
  await mkdir(OUT, { recursive: true });
  const bytes = gzipSync(encodeHeights(out, w, h, SHADOW_MAP.stepM), { level: 9 });
  await writeFile(join(OUT, path), bytes);
  console.log(`shadow map ${w}×${h}: ${(bytes.length / 1024).toFixed(0)} KB`);
}

async function main() {
  const t0 = Date.now();
  let base;
  let mips;
  let grids = null;
  let masks = [];
  if (MOSAIC) {
    const rasters = await loadRasters('heights');
    if (!rasters.length) throw new Error('No height rasters: run scripts/tiles/earth-mosaic.mjs first');
    base = rasters.find(isGlobal);
    if (!base) throw new Error('No global height raster for the shadow map and coarse levels');
    grids = rasters.map((r) => ({ grid: { west: r.west, north: r.north, east: r.east, south: r.south }, pixelM: pixelM(r), mips: buildMips(r) }));
    masks = (await loadRasters('mask')).map(({ w, h, west, north, east, south, sab }) => ({ w, h, west, north, east, south, sab }));
    console.log(`${rasters.length} height and ${masks.length} mask rasters loaded, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } else {
    base = await loadHeights();
    console.log(`${SPEC.source} ${base.w}×${base.h} loaded, ${base.filled} nodata samples filled, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
  await writeShadowMap(base);
  if (process.argv.includes('--shadow-only')) process.exit(0);
  if (!MOSAIC) mips = buildMips(base);
  console.log(`mips built, ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const tiles = allTiles();
  const workers = Math.max(1, availableParallelism() - 2);
  const ranges = { min: Infinity, max: -Infinity };
  const flat = [];
  let done = 0;
  await Promise.all(
    Array.from({ length: workers }, (_, wi) => new Promise((resolve, reject) => {
      const worker = new Worker(new URL(import.meta.url), { workerData: { body: BODY, mips, grids, masks, tiles: tiles.filter((_, i) => i % workers === wi) } });
      worker.on('message', (m) => {
        ranges.min = Math.min(ranges.min, m.min);
        ranges.max = Math.max(ranges.max, m.max);
        if (m.flat) flat.push(...m.flat);
        done += m.count;
        process.stdout.write(`  ${done}/${tiles.length}\r`);
      });
      worker.on('error', reject);
      worker.on('exit', (code) => (code ? reject(new Error(`worker exit ${code}`)) : resolve()));
    })),
  );
  console.log(`\n${tiles.length} height tiles in ${((Date.now() - t0) / 1000).toFixed(1)}s, range ${ranges.min} to ${ranges.max} m`);
  return { ranges, tiles, flat: masks.length ? new Set(flat) : null };
}

/** Bilinear lookup in a regional or global raster mip; global ones wrap in longitude. */
function sampleGrid(g, mip, lat, lon) {
  const fx = ((lon - g.west) / (g.east - g.west)) * mip.w - 0.5;
  const fy = ((g.north - lat) / (g.north - g.south)) * mip.h - 0.5;
  const wrap = g.east - g.west >= 360;
  const x0 = wrap ? Math.floor(fx) : Math.max(0, Math.min(mip.w - 2, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(mip.h - 2, Math.floor(fy)));
  const tx = wrap ? fx - x0 : Math.max(0, Math.min(1, fx - x0));
  const ty = Math.max(0, Math.min(1, fy - y0));
  const xa = ((x0 % mip.w) + mip.w) % mip.w;
  const xb = wrap ? (xa + 1) % mip.w : xa + 1;
  const d = mip.data;
  const r0 = y0 * mip.w;
  const r1 = r0 + mip.w;
  return (d[r0 + xa] * (1 - tx) + d[r0 + xb] * tx) * (1 - ty) + (d[r1 + xa] * (1 - tx) + d[r1 + xb] * tx) * ty;
}

/** Nearest mask byte from the finest mask raster that covers the point: 0 is water. */
function maskAt(masks, lat, lon) {
  for (const m of masks) {
    if (!covers(m, lat, lon)) continue;
    const x = Math.min(m.w - 1, Math.floor(((((lon - m.west) % 360) + 360) % 360 / (m.east - m.west)) * m.w));
    const y = Math.min(m.h - 1, Math.max(0, Math.floor(((m.north - lat) / (m.north - m.south)) * m.h)));
    return m.data[y * m.w + x];
  }
  return 255;
}

async function work() {
  const grids = workerData.grids?.map((g) => ({ ...g, mips: g.mips.map((m) => ({ ...m, data: new Int16Array(m.sab) })) }));
  const masks = workerData.masks.map((m) => ({ ...m, data: new Uint8Array(m.sab) }));
  const mips = grids ? null : workerData.mips.map((m) => ({ ...m, data: new Int16Array(m.sab) }));
  const sample = (mip, lat, lon) => {
    // Pixel-is-area grid starting at 180°W, 90°N.
    const fx = ((lon + 180) / 360) * mip.w - 0.5;
    const fy = ((90 - lat) / 180) * mip.h - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.max(0, Math.min(mip.h - 2, Math.floor(fy)));
    const tx = fx - x0;
    const ty = Math.max(0, Math.min(1, fy - y0));
    const xa = ((x0 % mip.w) + mip.w) % mip.w;
    const xb = (xa + 1) % mip.w;
    const d = mip.data;
    const r0 = y0 * mip.w;
    const r1 = r0 + mip.w;
    const top = d[r0 + xa] * (1 - tx) + d[r0 + xb] * tx;
    const bot = d[r1 + xa] * (1 - tx) + d[r1 + xb] * tx;
    return top * (1 - ty) + bot * ty;
  };
  const values = new Float32Array(HEIGHT_SIZE * HEIGHT_SIZE);
  let batch = { count: 0, min: Infinity, max: -Infinity, flat: [] };
  const mipFor = (count, spacingM, sourceM) => Math.max(0, Math.min(count - 1, Math.floor(Math.log2(spacingM / sourceM))));
  for (const k of workerData.tiles) {
    const spacingM = (tileEdgeKm(k.level, RADIUS_KM) * 1000) / TILES.heightCells;
    const m = mips && mipFor(mips.length, spacingM, SOURCE_M);
    let flat = masks.length > 0;
    for (let j = 0; j < HEIGHT_SIZE; j++) {
      for (let i = 0; i < HEIGHT_SIZE; i++) {
        const d = tileDir(k, heightSampleFraction(i), heightSampleFraction(j));
        const lat = (Math.asin(d[2]) * 180) / Math.PI;
        const lon = (Math.atan2(d[1], d[0]) * 180) / Math.PI;
        let v;
        if (grids) {
          const g = grids.find((c) => covers(c.grid, lat, lon)) ?? grids[grids.length - 1];
          v = Math.round(sampleGrid(g.grid, g.mips[mipFor(g.mips.length, spacingM, g.pixelM)], lat, lon));
        } else {
          v = Math.round(sample(mips[m], lat, lon));
        }
        if (flat && maskAt(masks, lat, lon) !== 0) flat = false;
        values[j * HEIGHT_SIZE + i] = v;
        if (v < batch.min) batch.min = v;
        if (v > batch.max) batch.max = v;
      }
    }
    const file = join(OUT, heightPath(k));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, gzipSync(encodeHeights(values), { level: 9 }));
    if (flat) batch.flat.push(tileId(k));
    if (++batch.count === 500) {
      parentPort.postMessage(batch);
      batch = { count: 0, min: Infinity, max: -Infinity, flat: [] };
    }
  }
  parentPort.postMessage(batch);
}

if (isMainThread) {
  const { ranges, tiles, flat } = await main();
  const metaFile = join(OUT, 'meta.json');
  const meta = await readFile(metaFile, 'utf8').then(JSON.parse).catch(() => ({}));
  const extra = {};
  if (flat) {
    const bits = new FlatOceanBuilder(MAX_LEVEL, meta.flatOcean);
    for (const k of tiles) bits.set(k, flat.has(tileId(k)));
    extra.flatOcean = bits.toJSON();
    console.log(`${flat.size} of ${tiles.length} height tiles are open ocean`);
  }
  // A partial (--near) bake widens the recorded range rather than replacing it.
  const heightRangeM = process.argv.includes('--near') && meta.heightRangeM ? [Math.min(ranges.min, meta.heightRangeM[0]), Math.max(ranges.max, meta.heightRangeM[1])] : [ranges.min, ranges.max];
  await writeFile(metaFile, JSON.stringify({ ...meta, body: BODY, radiusKm: RADIUS_KM, ...TILES, heightSize: HEIGHT_SIZE, heightRangeM, ...extra }, null, 2));
} else {
  await work();
}
