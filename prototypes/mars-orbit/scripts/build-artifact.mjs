// Packs the Vite build into a single-page artifact: the published page can't carry its
// own <html>/<head>/<body>, and same-origin scripts must be inlined to pass the CSP.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
let html = await readFile(root + 'dist/index.html', 'utf8');

const scriptTag = html.match(/<script type="module" crossorigin src="\/(assets\/[^"]+\.js)"><\/script>/);
if (!scriptTag) throw new Error('module script tag not found in dist/index.html');
const js = await readFile(root + 'dist/' + scriptTag[1], 'utf8');
if (/<\/script/i.test(js)) throw new Error('bundle contains </script and cannot be inlined');

html = html.replace(scriptTag[0], '');
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1].replace(/<meta charset[^>]*>\s*/, '').replace(/<meta name="viewport"[^>]*>\s*/, '');
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
const out = `${head.trim()}\n<style>:root { color-scheme: dark; } html, body { background: #000; }</style>\n${body.trim()}\n<script type="module">\n${js}\n</script>\n`;

await mkdir(root + 'artifact', { recursive: true });
await writeFile(root + 'artifact/index.html', out);
console.log(`artifact/index.html ${(out.length / 1e6).toFixed(2)} MB`);
