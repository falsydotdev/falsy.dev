// Encodes rendered poster frames to AVIF and writes src/data/posters.json.
// Usage: node scripts/posters/encode.mjs <frames.json>
// frames.json is written by render.mjs: [{ id, png, body, lat, lon, lst, altKm, relief, at, focus, portrait: { png, lat, lon, lst, altKm, at } }]
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';

const WIDTHS = [960, 1600, 2560];
const PORTRAIT_WIDTHS = [600, 1170];
const root = resolve(import.meta.dirname, '../..');
const framesPath = resolve(process.argv[2] ?? 'posters-out/frames.json');
const frames = JSON.parse(await readFile(framesPath, 'utf8'));
const outDir = resolve(root, 'public/posters');
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const posters = [];
for (const f of frames) {
  const encode = async (png, widths, suffix) => {
    const out = [];
    for (const w of widths) {
      const file = `${f.id}${suffix}-${w}.avif`;
      const info = await sharp(resolve(dirname(framesPath), png)).resize({ width: w }).avif({ quality: 66, effort: 6 }).toFile(resolve(outDir, file));
      out.push({ src: `/posters/${file}`, width: w, bytes: info.size });
    }
    return out;
  };
  const sources = await encode(f.png, WIDTHS, '');
  const { png: _png, portrait, ...meta } = f;
  const portraitSources = portrait ? await encode(portrait.png, PORTRAIT_WIDTHS, '-portrait') : [];
  posters.push({ ...meta, sources, ...(portrait && { portrait: { ...portrait, png: undefined, sources: portraitSources } }) });
  console.log(f.id, [...sources, ...portraitSources].map((s) => `${s.width}w ${(s.bytes / 1024).toFixed(0)} KB`).join(', '));
}

await writeFile(resolve(root, 'src/data/posters.json'), JSON.stringify(posters, null, 2) + '\n');

// Link previews don't support AVIF, so the first frame doubles as the JPEG share image.
const og = resolve(dirname(framesPath), frames[0].png);
await sharp(og).resize(1200, 630, { fit: 'cover', position: 'centre' }).jpeg({ quality: 82, mozjpeg: true }).toFile(resolve(root, 'public/og.jpg'));
