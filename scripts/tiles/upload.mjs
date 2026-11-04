// Uploads the baked tile set to R2 with rclone (`brew install rclone`). Credentials come from
// the environment (`doppler run -p falsy-dev -c prd -- npm run tiles:upload`) or, failing that,
// ~/.config/falsy-dev/r2.env, and reach rclone as environment variables so no config file holds
// them. Re-running only sends files that changed in size.
//   node scripts/tiles/upload.mjs [version]          default v1, uploaded to mars/<version>/
//   node scripts/tiles/upload.mjs [version] --size   count what's already in the bucket
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { TILE_DIR } from './paths.mjs';

const ENV_FILE = process.env.R2_ENV_FILE ?? join(homedir(), '.config', 'falsy-dev', 'r2.env');
const BUCKET = process.env.R2_BUCKET ?? 'falsy-tiles';
const version = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'v1';

const KEYS = ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ENDPOINT'];
const creds = KEYS.every((k) => process.env[k])
  ? Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
  : Object.fromEntries(
      readFileSync(ENV_FILE, 'utf8')
        .split('\n')
        .filter((l) => l.includes('='))
        .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
    );
for (const k of KEYS) {
  if (!creds[k]) throw new Error(`${k} missing from ${ENV_FILE}`);
}

const env = {
  ...process.env,
  RCLONE_CONFIG_R2_TYPE: 's3',
  RCLONE_CONFIG_R2_PROVIDER: 'Cloudflare',
  RCLONE_CONFIG_R2_ACCESS_KEY_ID: creds.R2_ACCESS_KEY_ID,
  RCLONE_CONFIG_R2_SECRET_ACCESS_KEY: creds.R2_SECRET_ACCESS_KEY,
  RCLONE_CONFIG_R2_ENDPOINT: creds.R2_ENDPOINT,
  RCLONE_CONFIG_R2_ACL: 'private',
};

const dest = `r2:${BUCKET}/mars/${version}`;
console.log(`${join(TILE_DIR, 'mars')} -> ${dest}`);
if (process.argv.includes('--size')) {
  process.exit(spawnSync('rclone', ['size', dest, '--fast-list'], { env, stdio: 'inherit' }).status ?? 1);
}
const res = spawnSync(
  'rclone',
  [
    '-v',
    'copy',
    join(TILE_DIR, 'mars'),
    dest,
    '--transfers', '64',
    '--checkers', '64',
    '--fast-list',
    '--size-only',
    '--s3-no-check-bucket',
    // Every version path is immutable; a re-bake goes to a new version.
    '--header-upload', 'Cache-Control: public, max-age=31536000, immutable',
    '--stats', '30s',
    '--stats-one-line',
  ],
  { env, stdio: 'inherit' },
);
process.exit(res.status ?? 1);
