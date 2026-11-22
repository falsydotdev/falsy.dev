import { gunzipSync, gzipSync } from 'node:zlib';
import sharp from 'sharp';
import { readBundle, writeBundle } from '../shared/bundle.js';
import { readGmgsi } from './gmgsi.js';
import { HEIGHT, WIDTH, dayKey, processClouds, reproject } from './process.js';

// AVIF keeps a real texture near 0.9 MB, under the 1.5 MB cloud budget (PNG is about 3 MB), and the
// scene already decodes AVIF tiles in a worker. sharp writes 3 equal sRGB channels; read red.
const AVIF = { quality: 55, effort: 4 };

export async function handleProcess(body) {
  const parts = readBundle(body);
  const part = (name) => parts.find((p) => p.name === name)?.bytes;
  const request = JSON.parse(new TextDecoder().decode(part('request.json')));
  const history = parts
    .filter((p) => p.name.startsWith('history/'))
    .map((p) => ({ day: p.name.slice('history/'.length), plane: gunzipSync(p.bytes) }));

  const backfilled = new Map();
  for (const p of parts.filter((p) => p.name.startsWith('backfill/'))) {
    const grid = await readGmgsi(p.bytes);
    backfilled.set(dayKey(grid.valid), reproject(grid));
  }
  for (const [day, plane] of backfilled) history.push({ day, plane });

  const grid = await readGmgsi(part('gmgsi.nc'));
  const { opacity, state, meta } = processClouds({ grid, history, source: request.source });
  backfilled.set(state.day, state.plane);

  const avif = await sharp(opacity, { raw: { width: WIDTH, height: HEIGHT, channels: 1 } })
    .avif(AVIF)
    .toBuffer();
  const out = [
    { name: 'clouds.avif', body: new Uint8Array(avif) },
    { name: 'meta.json', body: new TextEncoder().encode(JSON.stringify(meta)) },
    ...[...backfilled].map(([day, plane]) => ({ name: `state/${day}`, body: gzipSync(plane) })),
  ];
  const { stream } = writeBundle(out.map((p) => ({ ...p, size: p.body.length })));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
