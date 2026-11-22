// Writes public/og.jpg, a poster frame with the mark and wordmark over its sky, and its
// content hash to src/data/og.json for the share URL.
// Usage: node scripts/posters/og.mjs <frame image>
// The overlay's text is outlined, so CI renders it without the fonts installed.
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

const root = resolve(import.meta.dirname, '../..');

export async function writeOg(frame) {
  const base = await sharp(frame).resize(1200, 630, { fit: 'cover', position: 'centre' }).toBuffer();
  const jpeg = await sharp(base)
    .composite([{ input: resolve(import.meta.dirname, 'og-overlay.svg') }])
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  await writeFile(resolve(root, 'public/og.jpg'), jpeg);
  const version = createHash('sha256').update(jpeg).digest('hex').slice(0, 8);
  await writeFile(resolve(root, 'src/data/og.json'), JSON.stringify({ version }, null, 2) + '\n');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await writeOg(resolve(process.argv[2] ?? 'public/posters/mars-olympus-2560.avif'));
}
