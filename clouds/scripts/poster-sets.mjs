// Builds the cloud set each Earth poster still is pinned to, from NOAA's GMGSI archive, the way the
// cloud job would have kept it: the 3-hourly set at or before the moment, against the 14 days before.
// Usage: node clouds/scripts/poster-sets.mjs
// Writes kept/<stamp>/ and kept/index.json into the local stand-in that `astro dev` serves at
// /data/clouds (FALSY_TILES_CLOUDS, as for dev-bucket.mjs). The same kept/ files go in the bucket,
// since the job can only keep moments that fall after it starts running.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { handleProcess } from '../container/handler.js';
import { readBundle, writeBundle } from '../shared/bundle.js';
import { posterMoments } from '../worker/keep.js';

const NOAA = 'https://noaa-gmgsi-pds.s3.amazonaws.com';
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const WINDOW_DAYS = 14;

const data = process.env.FALSY_DATA_DIR ?? join(homedir(), '.cache', 'falsy-dev');
const out = process.env.FALSY_TILES_CLOUDS ?? join(data, 'tiles', 'clouds');
const cache = join(data, 'sources', 'gmgsi');
const shots = JSON.parse(readFileSync(new URL('../../scripts/posters/shots.json', import.meta.url), 'utf8'));

const stampOf = (d) => d.toISOString().slice(0, 16).replace(/[-:]/g, '') + 'Z';
const hourPrefix = (d) => `GMGSI_LW/${d.toISOString().slice(0, 13).replace(/[-T]/g, '/')}/`;

async function newestFile(hour) {
  const res = await fetch(`${NOAA}/?list-type=2&prefix=${encodeURIComponent(hourPrefix(hour))}`);
  if (!res.ok) throw new Error(`NOAA listing returned ${res.status}`);
  const keys = [...(await res.text()).matchAll(/<Key>([^<]+\.nc)<\/Key>/g)].map((m) => m[1]).sort();
  return keys.at(-1) ?? null;
}

async function download(key) {
  const path = join(cache, key.split('/').pop());
  if (!existsSync(path)) {
    const res = await fetch(`${NOAA}/${key}`);
    if (!res.ok) throw new Error(`NOAA download returned ${res.status} for ${key}`);
    writeFileSync(path, new Uint8Array(await res.arrayBuffer()));
    console.log(`  fetched ${key.split('/').pop()}`);
  }
  return readFileSync(path);
}

const part = (name, body) => ({ name, body, size: body.length });
const indexPath = join(out, 'kept', 'index.json');
const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : {};
mkdirSync(cache, { recursive: true });

for (const moment of posterMoments(shots)) {
  const valid = new Date(Math.floor(Date.parse(moment) / (3 * HOUR_MS)) * 3 * HOUR_MS);
  const stamp = stampOf(valid);
  const dir = join(out, 'kept', stamp);
  if (!existsSync(join(dir, 'meta.json'))) {
    console.log(`${moment}: building ${stamp} (about 7.3 MB per GMGSI file, ${WINDOW_DAYS + 1} files, cached in ${cache})`);
    const key = await newestFile(valid);
    if (!key) throw new Error(`No GMGSI file for ${valid.toISOString()}`);
    const earlier = [];
    for (let d = 1; d <= WINDOW_DAYS; d++) {
      const past = await newestFile(new Date(valid.getTime() - d * DAY_MS));
      if (past) earlier.push(past);
    }
    const request = { source: { bucket: 'noaa-gmgsi-pds', key }, valid: valid.toISOString() };
    const parts = [part('request.json', new TextEncoder().encode(JSON.stringify(request))), part('gmgsi.nc', await download(key))];
    for (const past of earlier) parts.push(part(`backfill/${past.match(/_s(\d{8})/)[1]}`, await download(past)));
    const { stream } = writeBundle(parts);
    const files = readBundle(await handleProcess(new Uint8Array(await new Response(stream).arrayBuffer())));
    mkdirSync(dir, { recursive: true });
    for (const name of ['clouds.avif', 'meta.json']) writeFileSync(join(dir, name), files.find((p) => p.name === name).bytes);
    const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
    console.log(`  ${dir}: clear-sky days ${meta.clearSky.days}, fallback ${meta.fallback}`);
  }
  index[moment] = stamp;
}
writeFileSync(indexPath, JSON.stringify(index));
console.log(`${indexPath}: ${Object.keys(index).length} poster moments`);
