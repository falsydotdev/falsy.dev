// Links the locally baked tile set into public/data so the dev server serves it at /data/mars.
// Bake it first with `npm run tiles` (downloads about 15 GB of USGS mosaics the first time).
import { existsSync, lstatSync, readlinkSync, symlinkSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { TILE_DIR } from './tiles/paths.mjs';

const root = resolve(import.meta.dirname, '..');
const link = resolve(root, 'public/data');

if (!existsSync(join(TILE_DIR, 'mars', 'meta.json'))) {
  console.error(`No tiles in ${TILE_DIR}. Run \`npm run tiles\` first.`);
  process.exit(1);
}
const current = (() => {
  try {
    return lstatSync(link).isSymbolicLink() ? readlinkSync(link) : 'not-a-link';
  } catch {
    return null;
  }
})();
if (current === 'not-a-link') {
  console.error(`${link} exists and isn't a symlink; move it aside first.`);
  process.exit(1);
}
if (current !== TILE_DIR) {
  if (current) unlinkSync(link);
  symlinkSync(TILE_DIR, link, 'dir');
}
console.log(`public/data -> ${TILE_DIR}`);
