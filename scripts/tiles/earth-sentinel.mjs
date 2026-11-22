// Overlays the Copernicus Sentinel-2 Global Mosaic onto Earth's fine colour rasters, so Blue
// Marble shows only where Sentinel-2 has no clear view (open ocean, beyond about ±83.75°, nodata).
// Reads each item's cloud-optimized GeoTIFF overview nearest 300 m, through presigned S3 URLs.
//   COPERNICUS_S3_ACCESS_KEY=… COPERNICUS_S3_SECRET_KEY=… node scripts/tiles/earth-sentinel.mjs
//   node scripts/tiles/earth-sentinel.mjs --list     search only; needs no keys
// Without keys it says so and leaves Blue Marble in place. Never log the keys. Either way it
// records the colour's period in the tiles' meta.json for the readout.
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EARTH_BAKE_DATE, TILE_DIR } from './paths.mjs';
import { listRasters, pixelDeg } from './mosaic-rasters.mjs';
import { colorPeriod, mosaicQuarter, toneReflectance } from './earth/sentinel.ts';
import { presignGet } from './earth/s3.ts';
import { toUtm } from './earth/utm.ts';

const STAC = 'https://stac.dataspace.copernicus.eu/v1/search';
const S3_ENDPOINT = 'https://eodata.dataspace.copernicus.eu';
const TARGET_M = 300;
const BANDS = ['B04', 'B03', 'B02'];
const NODATA = -32768;

const keys = { accessKeyId: process.env.COPERNICUS_S3_ACCESS_KEY, secretAccessKey: process.env.COPERNICUS_S3_SECRET_KEY };
const listOnly = process.argv.includes('--list');

async function recordPeriod(sentinelPixels) {
  const out = join(TILE_DIR, 'earth');
  const metaFile = join(out, 'meta.json');
  const meta = await readFile(metaFile, 'utf8').then(JSON.parse).catch(() => ({}));
  const period = colorPeriod(EARTH_BAKE_DATE, sentinelPixels);
  await mkdir(out, { recursive: true });
  await writeFile(metaFile, JSON.stringify({ ...meta, colorPeriod: period }, null, 2));
  console.log(`Colour period: ${JSON.stringify(period)}`);
}

if (!listOnly && (!keys.accessKeyId || !keys.secretAccessKey)) {
  console.log('Sentinel-2 skipped: set COPERNICUS_S3_ACCESS_KEY and COPERNICUS_S3_SECRET_KEY to overlay it. Colour stays Blue Marble.');
  await recordPeriod(0);
  process.exit(0);
}

const q = mosaicQuarter(EARTH_BAKE_DATE);
const lastDay = new Date(Date.UTC(q.year, q.quarter * 3, 0)).getUTCDate();
const datetime = `${q.year}-${q.firstMonth}-01T00:00:00Z/${q.year}-${String(q.quarter * 3).padStart(2, '0')}-${lastDay}T23:59:59Z`;

async function search(bbox) {
  const items = [];
  let body = { collections: ['sentinel-2-global-mosaics'], bbox, datetime, limit: 200 };
  let url = STAC;
  while (url) {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`STAC search: status ${res.status}`);
    const page = await res.json();
    items.push(...page.features);
    const next = page.links?.find((l) => l.rel === 'next');
    url = next?.href;
    body = next?.body ?? body;
  }
  return items;
}

const httpsOf = (href) => `${S3_ENDPOINT}/${href.replace(/^s3:\/\//, '')}`;

/** The overview nearest TARGET_M without going coarser, as int16 samples plus its UTM geometry. */
async function readItem(item) {
  const { fromUrl } = await import('geotiff');
  const [scale, , x0, , , y0] = item.assets.B04['proj:transform'];
  const baseW = item.assets.B04['proj:shape'][1];
  const bands = [];
  let geometry;
  for (const band of BANDS) {
    const tiff = await fromUrl(presignGet(httpsOf(item.assets[band].href), { ...keys, region: 'default', expiresS: 3600 }));
    const count = await tiff.getImageCount();
    let pick = -1;
    let best = Infinity;
    for (let i = 0; i < count; i++) {
      const m = (scale * baseW) / (await tiff.getImage(i)).getWidth();
      if (Math.abs(m - TARGET_M) < best) [pick, best] = [i, Math.abs(m - TARGET_M)];
    }
    const pickedM = (scale * baseW) / (await tiff.getImage(pick)).getWidth();
    // Without a usable overview this would read the 10 m base, about 190 MB per band.
    if (pickedM < 100 || pickedM > 350) throw new Error(`no overview near ${TARGET_M} m (nearest ${Math.round(pickedM)} m)`);
    const img = await tiff.getImage(pick);
    const [data] = await img.readRasters();
    geometry = { x0, y0, step: (scale * baseW) / img.getWidth(), w: img.getWidth(), h: img.getHeight() };
    bands.push(data);
  }
  return { bands, ...geometry };
}

async function overlay(raster, item, src) {
  const epsg = Number(item.properties['proj:code'].split(':')[1]);
  const zone = epsg % 100;
  const north = epsg < 32700;
  const [w, s, e, n] = item.bbox;
  const sx = raster.w / (raster.east - raster.west);
  const sy = raster.h / (raster.north - raster.south);
  const c0 = Math.max(0, Math.floor((w - raster.west) * sx));
  const c1 = Math.min(raster.w, Math.ceil((e - raster.west) * sx));
  const r0 = Math.max(0, Math.floor((raster.north - n) * sy));
  const r1 = Math.min(raster.h, Math.ceil((raster.north - s) * sy));
  if (c1 <= c0 || r1 <= r0) return 0;
  const fh = await open(raster.file, 'r+');
  const rows = BANDS.map(() => Buffer.alloc(c1 - c0));
  let written = 0;
  for (let r = r0; r < r1; r++) {
    for (let b = 0; b < 3; b++) await fh.read(rows[b], 0, c1 - c0, (b * raster.h + r) * raster.w + c0);
    const lat = raster.north - (r + 0.5) / sy;
    for (let c = c0; c < c1; c++) {
      const { x, y } = toUtm(lat, raster.west + (c + 0.5) / sx, zone, north);
      const fx = (x - src.x0) / src.step - 0.5;
      const fy = (src.y0 - y) / src.step - 0.5;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      if (ix < 0 || iy < 0 || ix + 1 >= src.w || iy + 1 >= src.h) continue;
      const tx = fx - ix;
      const ty = fy - iy;
      const k = iy * src.w + ix;
      const taps = [k, k + 1, k + src.w, k + src.w + 1];
      if (src.bands.some((band) => taps.some((t) => band[t] === NODATA))) continue;
      src.bands.forEach((band, b) => {
        const dn = (band[k] * (1 - tx) + band[k + 1] * tx) * (1 - ty) + (band[k + src.w] * (1 - tx) + band[k + src.w + 1] * tx) * ty;
        rows[b][c - c0] = toneReflectance(dn);
      });
      written++;
    }
    for (let b = 0; b < 3; b++) await fh.write(rows[b], 0, c1 - c0, (b * raster.h + r) * raster.w + c0);
  }
  await fh.close();
  return written;
}

console.log(`Sentinel-2 Global Mosaic ${q.year} Q${q.quarter}`);
let total = 0;
// Only rasters near Blue Marble's 1/240° gain from it; the coarse test fill doesn't.
for (const raster of listRasters('colour').filter((r) => pixelDeg(r) <= 1 / 200)) {
  const items = await search([raster.west, raster.south, raster.east, raster.north]);
  console.log(`  ${raster.file}: ${items.length} items`);
  if (listOnly) {
    for (const item of items.slice(0, 5)) console.log(`    ${item.id} ${item.properties['proj:code']} ${item.assets.B04.href}`);
    continue;
  }
  let pixels = 0;
  let failed = 0;
  for (const [i, item] of items.entries()) {
    try {
      pixels += await overlay(raster, item, await readItem(item));
    } catch (err) {
      // Only the message: a stack or request could carry a presigned URL, which holds the key ID.
      failed++;
      console.log(`    ${item.id} skipped: ${String(err?.message ?? err).replace(/https?:\/\/\S+/g, '<url>')}`);
    }
    process.stdout.write(`    ${i + 1}/${items.length} items, ${pixels} pixels from Sentinel-2${failed ? `, ${failed} skipped` : ''}\n`);
  }
  total += pixels;
}
if (!listOnly) await recordPeriod(total);
