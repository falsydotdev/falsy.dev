// Builds prototype textures by range-reading the USGS GeoTIFFs on S3 (uncompressed,
// one row per strip), so we never download the 2 GB / 12 GB source files.
import { fromUrl } from 'geotiff';
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../public/data/', import.meta.url));
const MOLA = 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif';
const VIKING = 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars_Viking_MDIM21_ClrMosaic_global_232m.tif';

export const HEIGHT_OFFSET = 10000;
export const REGION = { latMin: 10, latMax: 28, lonMin: 216, lonMax: 237 };

async function openRows(url) {
  const tiff = await fromUrl(url);
  const img = await tiff.getImage(0);
  const offsets = await img.fileDirectory.loadValue('StripOffsets');
  const height = img.getHeight();
  const spp = img.getSamplesPerPixel();
  const planar = offsets.length === height * spp && spp > 1;
  return { url, width: img.getWidth(), height, spp, planar, bps: img.getBitsPerSample() / 8, offsets };
}

async function fetchRange(url, start, length, attempt = 0) {
  try {
    const res = await fetch(url, { headers: { Range: `bytes=${start}-${start + length - 1}` } });
    if (res.status !== 206) throw new Error(`status ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length !== length) throw new Error(`short read ${buf.length}/${length}`);
    return buf;
  } catch (err) {
    if (attempt >= 4) throw err;
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    return fetchRange(url, start, length, attempt + 1);
  }
}

async function pool(items, concurrency, fn) {
  let next = 0;
  let done = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
      if (++done % 256 === 0) process.stdout.write(`  ${done}/${items.length}\r`);
    }
  });
  await Promise.all(workers);
  process.stdout.write(`  ${done}/${items.length}\n`);
}

// Reads source rows (optionally a column window) and box-averages horizontally
// into outWidth columns. Rows are point-sampled at block centres.
async function resample(src, { row0, nrows, col0, ncols, outW, outH, nodata }) {
  const out = new Float32Array(outW * outH * src.spp);
  const pxBytes = src.spp * src.bps;
  const rows = Array.from({ length: outH }, (_, r) => row0 + Math.floor(((r + 0.5) * nrows) / outH));
  // Planar files store each band as its own run of strips: band s, row r is strip s*height + r.
  const readRow = async (srcRow) => {
    if (!src.planar) {
      const bytes = await fetchRange(src.url, src.offsets[srcRow] + col0 * pxBytes, ncols * pxBytes);
      return (x, s) => (src.bps === 2 ? new DataView(bytes.buffer).getInt16((x * src.spp + s) * 2, true) : bytes[x * src.spp + s]);
    }
    const bands = await Promise.all(
      Array.from({ length: src.spp }, (_, s) => fetchRange(src.url, src.offsets[s * src.height + srcRow] + col0 * src.bps, ncols * src.bps)),
    );
    return (x, s) => bands[s][x];
  };
  await pool(rows, 32, async (srcRow, r) => {
    const get = await readRow(srcRow);
    for (let c = 0; c < outW; c++) {
      const a = Math.floor((c * ncols) / outW);
      const b = Math.max(a + 1, Math.floor(((c + 1) * ncols) / outW));
      for (let s = 0; s < src.spp; s++) {
        let sum = 0;
        let n = 0;
        for (let x = a; x < b; x++) {
          const v = get(x, s);
          if (v === nodata) continue;
          sum += v;
          n++;
        }
        out[(r * outW + c) * src.spp + s] = n ? sum / n : NaN;
      }
    }
  });
  return out;
}

function encodeHeight(values, w, h) {
  const rgb = Buffer.alloc(w * h * 3);
  let last = 0;
  for (let i = 0; i < w * h; i++) {
    const v = Number.isNaN(values[i]) ? last : values[i];
    last = v;
    const u = Math.max(0, Math.min(65535, Math.round(v + HEIGHT_OFFSET)));
    rgb[i * 3] = u >> 8;
    rgb[i * 3 + 1] = u & 255;
  }
  return sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).png({ compressionLevel: 9 });
}

function encodeColor(values, w, h) {
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0; i < rgb.length; i++) rgb[i] = Number.isNaN(values[i]) ? 0 : Math.round(values[i]);
  return sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 88, mozjpeg: true });
}

function regionWindow(src) {
  const ppd = src.width / 360;
  const lon = (l) => (l > 180 ? l - 360 : l);
  return {
    col0: Math.round((lon(REGION.lonMin) + 180) * ppd),
    ncols: Math.round((REGION.lonMax - REGION.lonMin) * ppd),
    row0: Math.round((90 - REGION.latMax) * ppd),
    nrows: Math.round((REGION.latMax - REGION.latMin) * ppd),
  };
}

await mkdir(OUT, { recursive: true });
const mola = await openRows(MOLA);
const viking = await openRows(VIKING);

const only = process.argv[2];
const jobs = {
  async globalHeight() {
    const [outW, outH] = [4096, 2048];
    const v = await resample(mola, { row0: 0, nrows: mola.height, col0: 0, ncols: mola.width, outW, outH, nodata: -32768 });
    await encodeHeight(v, outW, outH).toFile(OUT + 'mars_height_4k.png');
  },
  async regionHeight() {
    const win = regionWindow(mola);
    const v = await resample(mola, { ...win, outW: win.ncols, outH: win.nrows, nodata: -32768 });
    await encodeHeight(v, win.ncols, win.nrows).toFile(OUT + 'om_height.png');
  },
  async regionColor() {
    const win = regionWindow(viking);
    const outW = 4096;
    const outH = Math.round((outW * win.nrows) / win.ncols);
    const v = await resample(viking, { ...win, outW, outH, nodata: -1 });
    await encodeColor(v, outW, outH).toFile(OUT + 'om_color.jpg');
  },
  async globalColor() {
    const [outW, outH] = [8192, 4096];
    const v = await resample(viking, { row0: 0, nrows: viking.height, col0: 0, ncols: viking.width, outW, outH, nodata: -1 });
    await encodeColor(v, outW, outH).toFile(OUT + 'mars_color_8k.jpg');
  },
};

for (const [name, job] of Object.entries(jobs)) {
  if (only && only !== name) continue;
  const t = Date.now();
  console.log(name);
  await job();
  console.log(`  done in ${((Date.now() - t) / 1000).toFixed(1)}s`);
}
await writeFile(OUT + 'meta.json', JSON.stringify({ heightOffset: HEIGHT_OFFSET, region: REGION, radiusKm: 3396.19 }, null, 2));
