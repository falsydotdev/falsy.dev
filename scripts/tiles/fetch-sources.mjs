// Downloads the USGS Mars mosaics with parallel range requests (single streams run at
// about 3 MB/s from Australia). Resumable: finished chunks are recorded beside the file.
import { open, mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { SOURCES, SOURCE_DIR } from './paths.mjs';

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
const only = process.argv[2];
for (const [name, src] of Object.entries(SOURCES)) {
  if (only && only !== name) continue;
  console.log(`${name}: ${src.url}`);
  await download(src);
}
