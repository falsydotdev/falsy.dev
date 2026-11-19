// Fails when a built page's compressed HTML no longer fits a new connection's first round trip.
// Ten 1460-byte packets is 14.6 KB; 1 KB is left for headers. Past it, first paint waits a whole
// extra round trip (150 ms in Lighthouse's mobile profile), which is what pushed LCP over budget.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const LIMIT = 13_600;
const dist = resolve(import.meta.dirname, '../dist');
const pages = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? pages(join(dir, e.name)) : e.name.endsWith('.html') ? [join(dir, e.name)] : []));

let failed = false;
for (const page of pages(dist)) {
  const bytes = gzipSync(readFileSync(page), { level: 6 }).length;
  const over = bytes > LIMIT;
  failed ||= over;
  console.log(`${over ? 'FAIL' : 'ok  '} ${String(bytes).padStart(6)} B  ${relative(dist, page)}`);
}
if (failed) {
  console.error(`\nA page's compressed HTML is over ${LIMIT} bytes. Look for inlined assets (fonts, images) or data that grew.`);
  process.exit(1);
}
