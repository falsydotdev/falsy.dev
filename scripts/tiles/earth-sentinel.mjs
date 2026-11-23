// Overlays the Copernicus Sentinel-2 Global Mosaic onto the land of Earth's fine colour rasters,
// from its low-resolution product (36° lat/lon tiles at 0.0036°), resampled bilinearly to 1/240°.
// Water keeps Blue Marble, since the renderer shades it; so do nodata pixels. Toward the polar
// coverage edges Sentinel-2 blends into the Blue Marble already in the raster (SENTINEL_RAMP).
//   CDSE_S3_ACCESS_KEY=… CDSE_S3_SECRET_KEY=… node scripts/tiles/earth-sentinel.mjs
//   node scripts/tiles/earth-sentinel.mjs --list     tiles per raster; needs no keys
// Without keys it says so and leaves Blue Marble in place. Never log the keys. Either way it
// records the colour's period in the tiles' meta.json for the readout.
import { appendFile, mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EARTH_BAKE_DATE, TILE_DIR } from './paths.mjs';
import { covers, listRasters, pixelDeg } from './mosaic-rasters.mjs';
import { colorPeriod, copernicusYear, mosaicQuarter } from './earth/sentinel.ts';
import { LOW_RES_SIZE, LOW_RES_STEP, SENTINEL_RAMP, lowResKey, lowResTilesFor, overlayRow, rowLat, sentinelWeight, sourceWindow, sourceX, sourceY, targetWindow } from './earth/lowres.ts';
import { signHeaders } from './earth/s3.ts';

const S3_ENDPOINT = 'https://eodata.dataspace.copernicus.eu';
const BANDS = ['B04', 'B03', 'B02'];
// Copernicus allows 4 connections and 2000 requests a minute; stay at the first and half the second.
const MAX_CONNECTIONS = 4;
const MIN_GAP_MS = 60;
const RETRIES = 8;

const keys = { accessKeyId: process.env.CDSE_S3_ACCESS_KEY, secretAccessKey: process.env.CDSE_S3_SECRET_KEY };
const listOnly = process.argv.includes('--list');

async function recordPeriod(sentinelPixels) {
  const out = join(TILE_DIR, 'earth');
  const metaFile = join(out, 'meta.json');
  const meta = await readFile(metaFile, 'utf8').then(JSON.parse).catch(() => ({}));
  const period = colorPeriod(EARTH_BAKE_DATE, sentinelPixels);
  await mkdir(out, { recursive: true });
  await writeFile(metaFile, JSON.stringify({ ...meta, colorPeriod: period }, null, 2));
  console.log(`Colour period: ${JSON.stringify(period)}`);
  console.log(`Before uploading, set EARTH.tiles.sentinelYear in src/scene/bodies.ts to ${copernicusYear(period)} for the footer credit.`);
}

if (!listOnly && (!keys.accessKeyId || !keys.secretAccessKey)) {
  console.log('Sentinel-2 skipped: set CDSE_S3_ACCESS_KEY and CDSE_S3_SECRET_KEY to overlay it. Colour stays Blue Marble.');
  await recordPeriod(0);
  process.exit(0);
}

const q = mosaicQuarter(EARTH_BAKE_DATE);
// Only rasters near Blue Marble's 1/240° gain from it; the coarse test fill doesn't.
const rasters = listRasters('colour').filter((r) => pixelDeg(r) <= 1 / 200);
console.log(`Sentinel-2 Global Mosaic ${q.year} Q${q.quarter}, low resolution`);
if (q.quarter !== SENTINEL_RAMP.quarter) console.log(`  warning: SENTINEL_RAMP was measured on a Q${SENTINEL_RAMP.quarter} mosaic; check the polar coverage edges for Q${q.quarter}`);

if (listOnly) {
  for (const raster of rasters) {
    const tiles = lowResTilesFor(raster);
    console.log(`  ${raster.file}: ${tiles.length} tiles`);
    for (const tile of tiles) console.log(`    ${tile.name} s3://${lowResKey(q, tile.name, BANDS[0])}`);
  }
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let active = 0;
let nextStart = 0;
const queue = [];
const stats = { bytes: 0, requests: 0, retries: 0 };

/** Runs `fn` holding one of the connections, spaced so requests stay under the per-minute quota. */
async function withConnection(fn) {
  while (active >= MAX_CONNECTIONS) await new Promise((r) => queue.push(r));
  active++;
  try {
    const now = Date.now();
    const at = Math.max(now, nextStart);
    nextStart = at + MIN_GAP_MS;
    if (at > now) await sleep(at - now);
    return await fn();
  } finally {
    active--;
    queue.shift()?.();
  }
}

const { BaseClient, BaseResponse, fromCustomClient } = await import('geotiff');

class Fetched extends BaseResponse {
  constructor(status, headers, data) {
    super();
    Object.assign(this, { code: status, headers, data });
  }
  get status() {
    return this.code;
  }
  getHeader(name) {
    return this.headers.get(name) ?? undefined;
  }
  async getData() {
    return this.data;
  }
}

/** geotiff's range reads, signed afresh on every attempt (a long run outlives one signature). */
class SignedClient extends BaseClient {
  async request({ headers, signal } = {}) {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await withConnection(async () => {
          const r = await fetch(this.url, { headers: { ...headers, ...signHeaders(this.url, { ...keys, region: 'default' }) }, signal });
          return new Fetched(r.status, r.headers, await r.arrayBuffer());
        });
        if (res.status === 429 || res.status >= 500) throw Object.assign(new Error(`status ${res.status}`), { retry: true });
        stats.requests++;
        if (res.ok) stats.bytes += res.data.byteLength;
        return res;
      } catch (err) {
        // fetch throws TypeError for network failures; other HTTP errors come back as a status.
        const retry = err?.retry || err instanceof TypeError;
        if (!retry || attempt >= RETRIES) throw err;
        stats.retries++;
        await sleep(Math.min(60000, 1000 * 2 ** attempt) * (0.5 + Math.random()));
      }
    }
  }
}

async function openBand(tile, band) {
  // Blocks let geotiff merge a strip's neighbouring internal tiles into one request.
  const source = { blockSize: 524288, cacheSize: 64 };
  const img = await (await fromCustomClient(new SignedClient(`${S3_ENDPOINT}/${lowResKey(q, tile.name, band)}`), source)).getImage(0);
  const [x0, y0] = img.getOrigin();
  const [rx] = img.getResolution();
  if (img.getWidth() !== LOW_RES_SIZE || img.getHeight() !== LOW_RES_SIZE || Math.abs(rx - LOW_RES_STEP) > 1e-9 || x0 !== tile.west || y0 !== tile.north) {
    throw new Error(`${tile.name} ${band}: unexpected grid ${img.getWidth()}² at ${rx}° from ${x0},${y0}`);
  }
  return img;
}

/** Water mask bytes (0 water) under raster row `y`, columns x0..x1, from the finest mask covering each pixel. */
async function maskRow(raster, masks, y, x0, x1) {
  const out = new Uint8Array(x1 - x0).fill(255);
  const pending = new Uint8Array(x1 - x0).fill(1);
  const lat = rowLat(raster, y);
  const lonOf = (x) => raster.west + ((x + 0.5) * (raster.east - raster.west)) / raster.w;
  for (const m of masks) {
    const my = Math.min(m.h - 1, Math.max(0, Math.floor(((m.north - lat) / (m.north - m.south)) * m.h)));
    const cols = [];
    let lo = Infinity;
    let hi = -1;
    for (let x = x0; x < x1; x++) {
      if (!pending[x - x0] || !covers(m, lat, lonOf(x))) continue;
      const mx = Math.min(m.w - 1, Math.floor(((((lonOf(x) - m.west) % 360) + 360) % 360 / (m.east - m.west)) * m.w));
      cols.push(x, mx);
      lo = Math.min(lo, mx);
      hi = Math.max(hi, mx);
    }
    if (!cols.length) continue;
    const seg = Buffer.alloc(hi - lo + 1);
    await m.fh.read(seg, 0, seg.length, my * m.w + lo);
    for (let i = 0; i < cols.length; i += 2) {
      out[cols[i] - x0] = seg[cols[i + 1] - lo];
      pending[cols[i] - x0] = 0;
    }
  }
  return out;
}

async function overlayTile(raster, fh, masks, tile) {
  const win = targetWindow(raster, tile);
  if (win.x1 <= win.x0 || win.y1 <= win.y0) return 0;
  const src = sourceWindow(raster, tile, win);
  const w = win.x1 - win.x0;
  const sw = src.x1 - src.x0;
  const lands = [];
  for (let y = win.y0; y < win.y1; y++) {
    if (sentinelWeight(rowLat(raster, y)) <= 0) {
      lands.push(null);
      continue;
    }
    const mask = await maskRow(raster, masks, y, win.x0, win.x1);
    lands.push(mask.some((v) => v !== 0) ? mask : null);
  }
  if (!lands.some(Boolean)) return 0;
  const images = await Promise.all(BANDS.map((band) => openBand(tile, band)));
  const strip = images[0].getTileHeight();
  const fxs = Float64Array.from({ length: w }, (_, i) => sourceX(raster, tile, win.x0 + i) - src.x0);
  // Source rows buf.y0..buf.y1 of each band. Reads end on the file's own tile rows, so none is fetched twice.
  let buf = null;
  async function ensure(lo, hi) {
    if (buf && buf.y0 <= lo && hi <= buf.y1) return;
    const keep = buf && lo >= buf.y0 && lo < buf.y1;
    const start = keep ? buf.y1 : lo;
    const end = Math.min(src.y1, Math.max(hi, (Math.floor(start / strip) + 1) * strip));
    const fresh = await Promise.all(images.map((img) => img.readRasters({ window: [src.x0, start, src.x1, end], samples: [0] }).then((r) => r[0])));
    const y0 = keep ? lo : start;
    buf = {
      y0,
      y1: end,
      bands: fresh.map((rows, b) => {
        const data = new Int16Array((end - y0) * sw);
        if (keep) data.set(buf.bands[b].subarray((lo - buf.y0) * sw));
        data.set(rows, (start - y0) * sw);
        return data;
      }),
    };
  }
  const at = (b, y) => (b * raster.h + y) * raster.w + win.x0;
  // A blend reads the row it writes, so a tile that fails partway must not have blended any row
  // yet: its rerun would blend those twice. Blended rows wait until every fetch has succeeded.
  const blended = [];
  let written = 0;
  for (let y = win.y0; y < win.y1; y++) {
    const mask = lands[y - win.y0];
    if (!mask) continue;
    const weight = sentinelWeight(rowLat(raster, y));
    const fy = sourceY(raster, tile, y);
    const iy = Math.min(src.y1 - 1, Math.max(src.y0, Math.floor(fy)));
    await ensure(iy, Math.min(src.y1, iy + 2));
    const bands = buf.bands.map((data) => ({ data, w: sw, h: buf.y1 - buf.y0 }));
    const rows = BANDS.map(() => Buffer.alloc(w));
    for (let b = 0; b < 3; b++) await fh.read(rows[b], 0, w, at(b, y));
    const n = overlayRow(bands, fy - buf.y0, fxs, mask, rows, weight);
    if (!n) continue;
    if (weight < 1) blended.push({ y, rows });
    else for (let b = 0; b < 3; b++) await fh.write(rows[b], 0, w, at(b, y));
    written += n;
  }
  for (const { y, rows } of blended) for (let b = 0; b < 3; b++) await fh.write(rows[b], 0, w, at(b, y));
  return written;
}

const masks = await Promise.all(listRasters('mask').map(async (m) => ({ ...m, fh: await open(m.file, 'r') })));
if (!masks.length) console.log('  no water mask rasters: overlaying water too');
const t0 = Date.now();
let total = 0;
let totalFailed = 0;
for (const raster of rasters) {
  const tiles = lowResTilesFor(raster);
  console.log(`  ${raster.file}: ${tiles.length} tiles`);
  // A restart skips tiles already overlaid; earth-mosaic deletes this file when it rebuilds the raster.
  const doneFile = `${raster.file}.sentinel-done`;
  const tag = `${q.year}Q${q.quarter}`;
  const done = new Map(
    (await readFile(doneFile, 'utf8').catch(() => ''))
      .split('\n')
      .map((line) => line.split(' '))
      .filter(([t, name]) => t === tag && tiles.some((tile) => tile.name === name))
      .map(([, name, n]) => [name, Number(n)]),
  );
  let pixels = [...done.values()].reduce((a, n) => a + n, 0);
  let failed = 0;
  const fh = await open(raster.file, 'r+');
  for (const tile of tiles.filter((t) => !done.has(t.name))) {
    const started = Date.now();
    const before = stats.bytes;
    try {
      const n = await overlayTile(raster, fh, masks, tile);
      pixels += n;
      await appendFile(doneFile, `${tag} ${tile.name} ${n}\n`);
      console.log(`    ${tile.name}: ${n} pixels, ${((stats.bytes - before) / 1e6).toFixed(1)} MB in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    } catch (err) {
      // Only the message: a stack or request could carry the signed headers, which hold the key ID.
      failed++;
      console.log(`    ${tile.name} skipped: ${String(err?.message ?? err).replace(/https?:\/\/\S+/g, '<url>')}`);
    }
  }
  await fh.close();
  console.log(`    ${pixels} pixels from Sentinel-2${failed ? `, ${failed} tiles skipped` : ''}`);
  total += pixels;
  totalFailed += failed;
}
for (const m of masks) await m.fh.close();
console.log(`  fetched ${(stats.bytes / 1e6).toFixed(1)} MB in ${stats.requests} requests (${stats.retries} retried), ${((Date.now() - t0) / 1000).toFixed(1)}s`);
// A skipped tile would leave a 36° square of Blue Marble, so fail and let a rerun resume it.
if (totalFailed) {
  console.log(`Sentinel-2 incomplete: ${totalFailed} tiles skipped. Rerun to resume them.`);
  process.exit(1);
}
await recordPeriod(total);
