// Assembles Earth's tiled sources into rasters the cutters read (see mosaic-rasters.mjs):
//   heights  GEBCO_2026's eight 90° GeoTIFFs, 2×2 averaged to 1/120° (about 926 m)
//   mask     water (0) or land (255) at GEBCO's 1/240°: height ≤ 0 and outside Natural Earth land
//   colour   Blue Marble's eight 500 m JPEGs as planar RGB at 1/240°
//   node scripts/tiles/earth-mosaic.mjs [heights|colour] [--box s,w,n,e] [--remote]
//   node scripts/tiles/earth-mosaic.mjs --coarse     global 1/12° heights and mask, 8 km colour
// --box limits a raster to a region (snapped out to 1/120°), for test bakes over a coarse fill;
// --remote reads GEBCO rows with range requests instead of from downloaded files.
import { open, mkdir, writeFile } from 'node:fs/promises';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { SOURCES } from './paths.mjs';
import { writeHeader } from './mosaic-rasters.mjs';
import { quadTilesFor } from './earth/grid.ts';
import { LandRaster, readShapefilePolygons, waterMaskRow } from './earth/land.ts';

const sharp = createRequire(import.meta.url)('sharp');
const FINE = 240;
const QUAD = 90 * FINE;
const CONCURRENCY = 2;

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

function boxArg() {
  const text = arg('box');
  if (!text) return { west: -180, south: -90, east: 180, north: 90, tag: 'global' };
  const [s, w, n, e] = text.split(',').map(Number);
  const snap = (v, f) => f(v * 120) / 120;
  const box = { south: snap(s, Math.floor), west: snap(w, Math.floor), north: snap(n, Math.ceil), east: snap(e, Math.ceil) };
  return { ...box, tag: `box_${box.south}_${box.west}_${box.north}_${box.east}`.replace(/\./g, 'p') };
}

function landRings() {
  const zip = SOURCES.naturalEarthLand.file;
  const dir = mkdtempSync(join(tmpdir(), 'ne-land-'));
  const { status } = spawnSync('unzip', ['-q', '-o', zip, '*.shp', '-d', dir], { stdio: 'inherit' });
  if (status) throw new Error(`unzip ${zip} failed`);
  const shp = readdirSync(dir).find((n) => n.endsWith('.shp'));
  return readShapefilePolygons(new Uint8Array(readFileSync(join(dir, shp))));
}

async function withRetry(fn, attempt = 0) {
  try {
    return await fn();
  } catch (err) {
    if (attempt >= 12) throw err;
    await new Promise((r) => setTimeout(r, Math.min(30000, 1000 * 2 ** attempt)));
    return withRetry(fn, attempt + 1);
  }
}

/** Reads row segments of one GEBCO GeoTIFF: uncompressed int16, one row per strip. */
async function openGebco(tile, remote) {
  const src = SOURCES[`gebco${tile.name}`];
  const local = existsSync(src.file);
  if (!local && !remote) throw new Error(`${src.file} missing: run tiles:fetch -- --body earth, or pass --remote`);
  // Main thread only: geotiff's web-worker dependency hijacks worker threads that import it.
  const { fromFile, fromArrayBuffer } = await import('geotiff');
  // The header and strip tables sit in the first 256 KB; fetching them ourselves keeps every
  // request under our retries (CEDA drops connections now and then).
  const head = local ? null : await withRetry(async () => {
    const res = await fetch(src.url, { headers: { Range: 'bytes=0-262143' } });
    if (res.status !== 206) throw new Error(`status ${res.status}`);
    return res.arrayBuffer();
  });
  const header = async () => {
    const tiff = local ? await fromFile(src.file) : await fromArrayBuffer(head);
    const img = await tiff.getImage(0);
    const fd = img.fileDirectory;
    return { img, fd, compression: await fd.loadValue('Compression'), bits: await fd.loadValue('BitsPerSample'), offsets: await fd.loadValue('StripOffsets') };
  };
  const { img, compression, bits, offsets } = await withRetry(header);
  if (img.getWidth() !== QUAD || img.getHeight() !== QUAD || compression !== 1 || bits[0] !== 16) throw new Error(`${src.url}: expected ${QUAD}² uncompressed int16`);
  if (offsets.length !== QUAD) throw new Error(`${src.url}: expected one row per strip`);
  const little = img.littleEndian;
  const fh = local ? await open(src.file, 'r') : null;
  for (let i = 1; i < QUAD; i++) if (offsets[i] - offsets[i - 1] !== QUAD * 2) throw new Error(`${src.url}: rows aren't stored back to back`);
  // One range per block of rows: far fewer requests than a range per row, which a flaky host prefers.
  return async (y, count, x0, x1) => {
    const start = offsets[y] + x0 * 2;
    const length = (count - 1) * QUAD * 2 + (x1 - x0) * 2;
    let bytes;
    if (fh) {
      bytes = Buffer.alloc(length);
      await fh.read(bytes, 0, length, start);
    } else {
      // Kept on disk so an interrupted run doesn't fetch the same rows again.
      const cache = join(dirname(src.file), 'ranges', `${tile.name}_${y}_${count}_${x0}_${x1}.bin`);
      if (existsSync(cache)) bytes = readFileSync(cache);
      else {
        bytes = await withRetry(async () => {
          const res = await fetch(src.url, { headers: { Range: `bytes=${start}-${start + length - 1}` } });
          if (res.status !== 206) throw new Error(`status ${res.status}`);
          const b = Buffer.from(await res.arrayBuffer());
          if (b.length !== length) throw new Error(`short read ${b.length}`);
          return b;
        });
        await mkdir(dirname(cache), { recursive: true });
        await writeFile(cache, bytes);
      }
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    return Array.from({ length: count }, (_, r) => {
      const out = new Int16Array(x1 - x0);
      for (let i = 0; i < out.length; i++) out[i] = view.getInt16(r * QUAD * 2 + 2 * i, little);
      return out;
    });
  };
}

async function pool(tasks) {
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < tasks.length) await tasks[next++]();
  }));
}

async function fineHeights(box, remote) {
  const w4 = Math.round((box.east - box.west) * FINE);
  const h4 = Math.round((box.north - box.south) * FINE);
  const grid4 = { w: w4, h: h4, ...box };
  const grid2 = { w: w4 / 2, h: h4 / 2, ...box };
  const maskOut = await open(await writeHeader('mask', box.tag, grid4, 'uint8', 1), 'w');
  const heightOut = await open(await writeHeader('heights', box.tag, grid2, 'int16', 1), 'w');
  const land = new LandRaster(landRings(), grid4);
  const parts = quadTilesFor(box, QUAD);
  const readers = new Map();
  for (const p of parts) readers.set(p.tile.name, await openGebco(p.tile, remote));
  // Global pixel offsets of the box, and of each tile, at 1/240°.
  const bx = Math.round((box.west + 180) * FINE);
  const by = Math.round((90 - box.north) * FINE);
  const BLOCK = 64;
  const t0 = Date.now();
  const mask = new Uint8Array(w4);
  const landRow = new Uint8Array(w4);
  const half = new Int16Array(w4 / 2);
  for (let y = 0; y < h4; y += BLOCK) {
    const rows = Array.from({ length: Math.min(BLOCK, h4 - y) }, () => new Int16Array(w4));
    const tasks = [];
    for (const p of parts) {
      const top = Math.round((90 - p.tile.north) * FINE);
      const from = Math.max(p.y0, by + y - top);
      const to = Math.min(p.y1, by + y + rows.length - top);
      if (from >= to) continue;
      const ox = Math.round((p.tile.west + 180) * FINE) + p.x0 - bx;
      tasks.push(async () => {
        const got = await readers.get(p.tile.name)(from, to - from, p.x0, p.x1);
        got.forEach((seg, i) => rows[from + i + top - by - y].set(seg, ox));
      });
    }
    await pool(tasks);
    for (let r = 0; r < rows.length; r++) {
      waterMaskRow(rows[r], land.row(y + r, landRow), mask);
      await maskOut.write(mask, 0, w4, (y + r) * w4);
      if (r % 2) {
        const a = rows[r - 1];
        const b = rows[r];
        for (let x = 0; x < half.length; x++) half[x] = Math.round((a[2 * x] + a[2 * x + 1] + b[2 * x] + b[2 * x + 1]) / 4);
        await heightOut.write(new Uint8Array(half.buffer), 0, half.byteLength, ((y + r - 1) / 2) * half.byteLength);
      }
    }
    process.stdout.write(`  heights ${Math.min(h4, y + BLOCK)}/${h4} rows (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`);
  }
  await maskOut.close();
  await heightOut.close();
}

async function fineColour(box) {
  const w = Math.round((box.east - box.west) * FINE);
  const h = Math.round((box.north - box.south) * FINE);
  const out = await open(await writeHeader('colour', box.tag, { w, h, ...box }, 'uint8', 3), 'w');
  await out.truncate(w * h * 3);
  const bx = Math.round((box.west + 180) * FINE);
  const by = Math.round((90 - box.north) * FINE);
  for (const p of quadTilesFor(box, QUAD)) {
    const src = SOURCES[`bmng${p.tile.name}`];
    if (!existsSync(src.file)) {
      console.log(`  ${src.file} missing; its part of the box stays black`);
      continue;
    }
    const t0 = Date.now();
    const width = p.x1 - p.x0;
    const height = p.y1 - p.y0;
    const rgb = await sharp(src.file, { limitInputPixels: false, unlimited: true }).extract({ left: p.x0, top: p.y0, width, height }).removeAlpha().raw().toBuffer();
    const ox = Math.round((p.tile.west + 180) * FINE) + p.x0 - bx;
    const oy = Math.round((90 - p.tile.north) * FINE) + p.y0 - by;
    const plane = Buffer.alloc(width);
    for (let band = 0; band < 3; band++) {
      for (let r = 0; r < height; r++) {
        for (let x = 0; x < width; x++) plane[x] = rgb[(r * width + x) * 3 + band];
        await out.write(plane, 0, width, (band * h + oy + r) * w + ox);
      }
    }
    console.log(`  colour ${p.tile.name} ${width}×${height} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  await out.close();
}

/** OPeNDAP DAP2 binary: the DDS text, "Data:\n", then two big-endian counts and XDR int32 samples. */
function readDods(file) {
  const buf = readFileSync(file);
  const at = buf.indexOf('\nData:\n') + 7;
  const view = new DataView(buf.buffer, buf.byteOffset + at);
  const count = view.getUint32(0);
  const values = new Int32Array(count);
  for (let i = 0; i < count; i++) values[i] = view.getInt32(8 + 4 * i);
  return values;
}

async function coarse() {
  const box = { west: -180, south: -90, east: 180, north: 90 };
  const w = 4320;
  const h = 2160;
  const samples = readDods(SOURCES.gebcoCoarse.file);
  if (samples.length !== w * h) throw new Error(`expected ${w}×${h} GEBCO samples, got ${samples.length}`);
  const heights = new Int16Array(w * h);
  // OPeNDAP rows run south to north.
  for (let y = 0; y < h; y++) heights.set(samples.subarray((h - 1 - y) * w, (h - y) * w), y * w);
  const grid = { w, h, ...box };
  const land = new LandRaster(landRings(), grid);
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) waterMaskRow(heights.subarray(y * w, (y + 1) * w), land.row(y), mask.subarray(y * w, (y + 1) * w));
  const heightOut = await open(await writeHeader('heights', 'coarse', grid, 'int16', 1), 'w');
  await heightOut.write(new Uint8Array(heights.buffer));
  await heightOut.close();
  const maskOut = await open(await writeHeader('mask', 'coarse', grid, 'uint8', 1), 'w');
  await maskOut.write(mask);
  await maskOut.close();
  const { data, info } = await sharp(SOURCES.bmngCoarse.file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const planar = Buffer.alloc(n * 3);
  for (let i = 0; i < n; i++) for (let b = 0; b < 3; b++) planar[b * n + i] = data[i * 3 + b];
  const colourOut = await open(await writeHeader('colour', 'coarse', { w: info.width, h: info.height, ...box }, 'uint8', 3), 'w');
  await colourOut.write(planar);
  await colourOut.close();
  console.log(`coarse fill: heights and mask ${w}×${h}, colour ${info.width}×${info.height}`);
}

const kinds = ['heights', 'colour'].filter((k) => process.argv.includes(k));
if (process.argv.includes('--coarse')) {
  await coarse();
} else {
  const box = boxArg();
  console.log(`mosaic ${box.tag}: ${box.south}..${box.north}°N, ${box.west}..${box.east}°E`);
  if (!kinds.length || kinds.includes('heights')) await fineHeights(box, process.argv.includes('--remote'));
  if (!kinds.length || kinds.includes('colour')) await fineColour(box);
}
