// Encodes rendered poster frames to AVIF and writes src/data/posters.json.
// Usage: node scripts/posters/encode.mjs <frames.json>
// frames.json is written by render.mjs: [{ id, png, body, lat, lon, lst, altKm, relief, at, focus }]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';

const WIDTHS = [960, 1600, 2560];
const root = resolve(import.meta.dirname, '../..');
const framesPath = resolve(process.argv[2] ?? 'posters-out/frames.json');
const frames = JSON.parse(await readFile(framesPath, 'utf8'));
const outDir = resolve(root, 'public/posters');
await mkdir(outDir, { recursive: true });

const posters = [];
for (const f of frames) {
  const png = resolve(dirname(framesPath), f.png);
  const sources = [];
  for (const w of WIDTHS) {
    const file = `${f.id}-${w}.avif`;
    const info = await sharp(png).resize({ width: w }).avif({ quality: 66, effort: 6 }).toFile(resolve(outDir, file));
    sources.push({ src: `/posters/${file}`, width: w, bytes: info.size });
  }
  const { png: _png, ...meta } = f;
  posters.push({ ...meta, sources });
  console.log(f.id, sources.map((s) => `${s.width}w ${(s.bytes / 1024).toFixed(0)} KB`).join(', '));
}

await writeFile(resolve(root, 'src/data/posters.json'), JSON.stringify(posters, null, 2) + '\n');

// Link previews don't support AVIF, so the first frame doubles as the JPEG share image.
const og = resolve(dirname(framesPath), frames[0].png);
await sharp(og).resize(1200, 630, { fit: 'cover', position: 'centre' }).jpeg({ quality: 82, mozjpeg: true }).toFile(resolve(root, 'public/og.jpg'));
