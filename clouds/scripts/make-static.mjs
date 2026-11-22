// Builds the static cloud map the scene uses until live clouds ship, through the container's own
// handler, so the texture and its pointer match what the job writes to the clouds bucket.
// Usage: node clouds/scripts/make-static.mjs <GMGSI .nc> <out dir> <earlier GMGSI .nc at the same hour>...
// Pass the 14 days before the main file for a full clear-sky reference.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { handleProcess } from '../container/handler.js';
import { readBundle, writeBundle } from '../shared/bundle.js';

const [input, outDir, ...earlier] = process.argv.slice(2);
if (!input || !outDir) throw new Error('Usage: make-static.mjs <GMGSI .nc> <out dir> <earlier .nc>...');

const day = (path) => basename(path).match(/_s(\d{8})/)?.[1] ?? basename(path).match(/(\d{8})/)?.[1];
const part = (name, body) => ({ name, body, size: body.length });
const [, y, m, d, h] = basename(input).match(/_s(\d{4})(\d\d)(\d\d)(\d\d)/);
const request = { source: { bucket: 'noaa-gmgsi-pds', key: `GMGSI_LW/${y}/${m}/${d}/${h}/${basename(input)}` } };
const parts = [
  part('request.json', new TextEncoder().encode(JSON.stringify(request))),
  part('gmgsi.nc', readFileSync(input)),
  ...earlier.map((path) => part(`backfill/${day(path)}`, readFileSync(path))),
];
const { stream } = writeBundle(parts);
const out = readBundle(await handleProcess(new Uint8Array(await new Response(stream).arrayBuffer())));
const file = (name) => out.find((p) => p.name === name).bytes;

const meta = JSON.parse(new TextDecoder().decode(file('meta.json')));
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'static.avif'), file('clouds.avif'));
// Shaped like the bucket's latest.json, with `path` relative to this file.
writeFileSync(join(outDir, 'static.json'), JSON.stringify({ ...meta, path: 'static.avif' }, null, 2) + '\n');
console.log(`${outDir}: ${file('clouds.avif').length} B, valid ${meta.valid}, clear-sky days ${meta.clearSky.days}, fallback ${meta.fallback}`);
