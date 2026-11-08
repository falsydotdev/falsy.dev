// Renders the poster stills from the site's own live scene, on this machine's GPU.
// Usage: node scripts/posters/render.mjs [--out <dir>] [--url <running dev server>] [--only <id>]
// Needs the local tiles (`npm run tiles:*`). Without --url it starts `astro dev` itself.
// The posters are a fixed set: each shot pins its time, so re-rendering gives the same frames.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { bodyById } from '../../src/scene/bodies.ts';

const { values: args } = parseArgs({
  options: {
    out: { type: 'string', default: 'posters-out' },
    url: { type: 'string' },
    port: { type: 'string', default: '4350' },
    only: { type: 'string' },
  },
});

const root = resolve(import.meta.dirname, '../..');
const outDir = resolve(root, args.out);
// Each shot renders twice, framed by the same solver as the live scene: laid out like a
// laptop screen at 2560 px wide, and like a phone at 1170 px wide. `live=1` forces the
// live scene on at phone width.
const VIEWS = [
  {
    key: 'landscape',
    viewport: { width: 1440, height: 810 },
    scale: 2560 / 1440,
  },
  { key: 'portrait', viewport: { width: 390, height: 844 }, scale: 3 },
];
const TIMEOUT = 120e3;

await mkdir(outDir, { recursive: true });

let server;
let base = args.url;
if (!base) {
  server = spawn(resolve(root, 'node_modules/.bin/astro'), ['dev', '--port', args.port], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
  base = await new Promise((ok, fail) => {
    server.stdout.on('data', (d) => {
      const m = d.toString().match(/http:\/\/localhost:\d+/);
      if (m) ok(m[0]);
    });
    server.on('exit', (code) => fail(new Error(`astro dev exited with ${code}`)));
  });
}

// The body name is the readout's switch button, so the spans start at latitude.
function parseTelemetry(spans) {
  const lat = spans[0].match(/([\d.]+)°([NS])/);
  const lon = spans[1].match(/([\d.]+)°E/);
  const lst = spans[2].match(/(\d\d:\d\d)/);
  const alt = spans[3].match(/(\d+) km/);
  if (!lat || !lon || !lst || !alt) throw new Error(`Unexpected telemetry: ${spans.join(' ')}`);
  return {
    lat: Number(lat[1]) * (lat[2] === 'S' ? -1 : 1),
    lon: Number(lon[1]),
    lst: lst[1],
    altKm: Number(alt[1]),
  };
}

const browser = await chromium.launch({
  channel: 'chromium',
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
  headless: true,
});

const shots = JSON.parse(await readFile(resolve(import.meta.dirname, 'shots.json'), 'utf8')).filter((s) => !args.only || s.id === args.only);
const frames = [];
try {
  for (const shot of shots) {
    const started = performance.now();
    const frame = {};
    for (const view of VIEWS) {
      // A shot can pick a different moment for the phone still with `portraitQuery`.
      const params = new URLSearchParams(shot.query);
      if (view.key === 'portrait') for (const [k, v] of new URLSearchParams(shot.portraitQuery ?? '')) params.set(k, v);
      const at = new Date(new Date(params.get('at')).getTime() + Number(params.get('skip') ?? 0) * 1000);
      const page = await browser.newPage({
        viewport: view.viewport,
        deviceScaleFactor: view.scale,
      });
      page.on('pageerror', (e) => console.error('page error:', e.message));
      await page.goto(`${base}/?${params}&t=0&tier=high&live=1&scale=${view.scale.toFixed(4)}`);
      await page.waitForSelector('.sky.is-live', { timeout: TIMEOUT });
      // Wait for every visible tile at full detail, then a few more frames for the fade-in.
      await page.waitForFunction(
        () => {
          const s = window.__falsyLive?.state;
          return s && s.tiles.pending === 0 && s.tiles.inFlight === 0 && s.frames > 30;
        },
        null,
        { timeout: TIMEOUT, polling: 250 },
      );
      await page.waitForTimeout(1500);
      const state = await page.evaluate(() => {
        const s = window.__falsyLive.state;
        return {
          backend: s.backend,
          spans: [...document.querySelectorAll('#telemetry span')].map((el) => el.textContent),
        };
      });
      if (state.backend !== 'WebGPU') throw new Error(`Expected WebGPU, got ${state.backend}`);
      await page.addStyleTag({
        content:
          'header, main, footer, .skip, #telemetry, .sky .grid, .sky .scrim, astro-dev-toolbar { visibility: hidden !important } html { scrollbar-width: none }',
      });
      await page.waitForTimeout(200);
      const png = `${shot.id}-${view.key}.png`;
      await page.screenshot({ path: resolve(outDir, png), scale: 'device' });
      frame[view.key] = { png, ...parseTelemetry(state.spans), at: at.toISOString() };
      await page.close();
    }
    const { query, portraitQuery, ...meta } = shot;
    const body = bodyById(new URLSearchParams(query).get('body'));
    frames.push({ ...meta, body: body.name, relief: body.relief, ...frame.landscape, portrait: frame.portrait });
    console.log(`${shot.id}: ${((performance.now() - started) / 1000).toFixed(1)} s`);
  }
} finally {
  await browser.close();
  server?.kill();
}

await writeFile(resolve(outDir, 'frames.json'), JSON.stringify(frames, null, 2) + '\n');
console.log(`Wrote ${frames.length} frames to ${outDir}`);
