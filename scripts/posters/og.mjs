// Writes public/og.jpg and its hash (src/data/og.json, for the share URL). Usage: node scripts/posters/og.mjs [frame]
// The overlay's text is outlined, so CI renders it without the fonts installed.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

const root = resolve(import.meta.dirname, '../..');

export async function writeOg(frame) {
  const jpeg = await sharp(frame)
    .resize(1200, 630, { fit: 'cover', position: 'centre' })
    .composite([{ input: resolve(import.meta.dirname, 'og-overlay.svg') }])
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  await writeFile(resolve(root, 'public/og.jpg'), jpeg);
  const version = createHash('sha256').update(jpeg).digest('hex').slice(0, 8);
  await writeFile(resolve(root, 'src/data/og.json'), JSON.stringify({ version }, null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Without a frame, use the largest still of the first poster, the same shot encode.mjs uses.
  const [first] = JSON.parse(await readFile(resolve(root, 'src/data/posters.json'), 'utf8'));
  const fallback = resolve(root, 'public', first.sources.at(-1).src.slice(1));
  await writeOg(process.argv[2] ? resolve(process.argv[2]) : fallback);
}
