// Downloads a body's source mosaics with parallel range requests (single streams run at
// about 3 MB/s from Australia). Resumable: finished chunks are recorded beside the file.
//   node scripts/tiles/fetch-sources.mjs [--body mars|moon|earth] [source[,source…]]
// Any source in SOURCES can be named, so `--body earth gebcoCoarse,bmngCoarse` fetches the test fill.
import { open, mkdir, readFile, writeFile, unlink, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { SOURCES, SOURCE_DIR, PIPELINE, bodyArg } from './paths.mjs';

const CHUNK = 32 * 1024 * 1024;
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 16);

async function fetchChunk(url, start, end, attempt = 0) {
  try {
    const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
    if (res.status !== 206) throw new Error(`status ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length !== end - start + 1) throw new Error(`short read ${buf.length}`);
    return buf;
  } catch (err) {
    if (attempt >= 6) throw err;
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    return fetchChunk(url, start, end, attempt + 1);
  }
}

// For responses built per request (OPeNDAP), which can't be fetched in ranges.
async function downloadWhole({ url, file }, attempt = 0) {
  if (existsSync(file)) return console.log(`${file} already complete`);
  let bytes;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: status ${res.status}`);
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    if (attempt >= 6) throw err;
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    return downloadWhole({ url, file }, attempt + 1);
  }
  await writeFile(`${file}.part`, bytes);
  await rename(`${file}.part`, file);
  console.log(`${file} complete`);
}

async function download({ url, file }) {
  const head = await fetch(url, { method: 'HEAD' });
  const size = Number(head.headers.get('content-length'));
  const progressFile = `${file}.progress.json`;
  const done = new Set(existsSync(progressFile) ? JSON.parse(await readFile(progressFile, 'utf8')) : []);
  if (existsSync(file) && !existsSync(progressFile)) return console.log(`${file} already complete`);
  if (!existsSync(progressFile)) await writeFile(progressFile, '[]');

  const fh = await open(file, existsSync(file) ? 'r+' : 'w+');
  await fh.truncate(size);
  const chunks = [];
  for (let i = 0; i * CHUNK < size; i++) if (!done.has(i)) chunks.push(i);
  const total = Math.ceil(size / CHUNK);
  const t0 = Date.now();
  let bytes = 0;
  let next = 0;
  let saving = Promise.resolve();
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < chunks.length) {
        const i = chunks[next++];
        const start = i * CHUNK;
        const end = Math.min(size, start + CHUNK) - 1;
        const buf = await fetchChunk(url, start, end);
        await fh.write(buf, 0, buf.length, start);
        done.add(i);
        bytes += buf.length;
        saving = saving.then(() => writeFile(progressFile, JSON.stringify([...done])));
        const mbps = bytes / 1e6 / ((Date.now() - t0) / 1000);
        process.stdout.write(`  ${done.size}/${total} chunks, ${mbps.toFixed(1)} MB/s\n`);
      }
    }),
  );
  await saving;
  await fh.close();
  await unlink(progressFile);
  console.log(`${file} complete`);
}

await mkdir(SOURCE_DIR, { recursive: true });
const spec = PIPELINE[bodyArg()];
const only = process.argv.slice(2).find((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--body')?.split(',');
const wanted = only ?? spec.fetch ?? [spec.heights.source, spec.heights.label, spec.colour.source].filter(Boolean);
for (const name of wanted) {
  const src = SOURCES[name];
  if (!src) throw new Error(`Unknown source ${name}`);
  console.log(`${name}: ${src.url}`);
  await mkdir(dirname(src.file), { recursive: true });
  await (src.whole ? downloadWhole(src) : download(src));
}
