// Lays out a local stand-in for the clouds bucket, which `astro dev` serves at /data/clouds, from
// the static map: `node clouds/scripts/dev-bucket.mjs [valid ISO time] [--no-latest]`.
// Each run adds a dated set and, unless --no-latest, points latest.json at it.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const HOUR_MS = 3_600_000;
const valid = new Date(args.find((a) => !a.startsWith('--')) ?? Math.floor(Date.now() / (3 * HOUR_MS)) * 3 * HOUR_MS);
if (Number.isNaN(valid.getTime())) throw new Error('Pass the valid time as an ISO date, e.g. 2026-11-22T09:00:00Z');
const out = process.env.FALSY_TILES_CLOUDS ?? join(process.env.FALSY_DATA_DIR ?? join(homedir(), '.cache', 'falsy-dev'), 'tiles', 'clouds');
const here = new URL('../../public/clouds/', import.meta.url);

const stamp = valid.toISOString().slice(0, 16).replace(/[-:]/g, '') + 'Z';
const { path: _path, ...meta } = JSON.parse(readFileSync(new URL('static.json', here), 'utf8'));
const set = { ...meta, valid: valid.toISOString(), fallback: null };
mkdirSync(join(out, 'dated', stamp), { recursive: true });
copyFileSync(new URL('static.avif', here), join(out, 'dated', stamp, 'clouds.avif'));
writeFileSync(join(out, 'dated', stamp, 'meta.json'), JSON.stringify(set));
if (!args.includes('--no-latest')) {
  const latest = { ...set, path: `dated/${stamp}/clouds.avif`, stale: false, checked: new Date().toISOString() };
  writeFileSync(join(out, 'latest.json'), JSON.stringify(latest));
}
console.log(`${join(out, 'dated', stamp)}${args.includes('--no-latest') ? '' : ' (latest)'}`);
