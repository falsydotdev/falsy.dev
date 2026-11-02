// Renders poster frames from the prototype renderer, then encodes them.
// Usage: node scripts/posters/render.mjs [--webgl] [--out <dir>]
//   --webgl  use SwiftShader WebGL2 (for GPU-less CI runners) instead of WebGPU
// Needs prototypes/mars-orbit/public/data. Build it with `npm run data` in that folder.
import { spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { nextSunrise } from '../../prototypes/mars-orbit/src/ephemeris.js';

const { values: args } = parseArgs({
  options: { webgl: { type: 'boolean', default: false }, out: { type: 'string', default: 'posters-out' }, port: { type: 'string', default: '5181' } },
});

const root = resolve(import.meta.dirname, '../..');
const proto = resolve(root, 'prototypes/mars-orbit');
const outDir = resolve(root, args.out);
const OLYMPUS = { lat: 18.65, lon: 226.2 };
const HOUR = 3600e3;

await access(resolve(proto, 'public/data/meta.json')).catch(() => {
  throw new Error('Missing prototype data. Run `npm run data` in prototypes/mars-orbit first.');
});
await mkdir(outDir, { recursive: true });

// The most recent sunrise, so the poster never shows a time that hasn't happened yet.
function lastSunrise(now) {
  for (const back of [26, 52]) {
    const t = nextSunrise(new Date(now - back * HOUR), OLYMPUS.lat, OLYMPUS.lon, 7);
    if (t && t.getTime() <= now) return t;
  }
  throw new Error('No Olympus Mons sunrise found in the last two sols');
}

function parseTelemetry(text) {
  const m = text.match(/([\d.]+)°([NS])\s+([\d.]+)°E\s+·\s+LOCAL SOLAR\s+(\d\d:\d\d)/);
  if (!m) throw new Error(`Unexpected telemetry: ${text}`);
  return { lat: Number(m[1]) * (m[2] === 'S' ? -1 : 1), lon: Number(m[3]), lst: m[4] };
}

const server = spawn(resolve(proto, 'node_modules/.bin/vite'), ['--port', args.port, '--strictPort'], { cwd: proto, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((ok, fail) => {
  server.stdout.on('data', (d) => d.toString().includes('Local') && ok());
  server.on('exit', (code) => fail(new Error(`vite exited with ${code}`)));
});

const launchArgs = args.webgl
  ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  : ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ channel: 'chromium', args: launchArgs, headless: true });
const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('page error:', e.message));

const shots = JSON.parse(await readFile(resolve(import.meta.dirname, 'shots.json'), 'utf8'));
const frames = [];
try {
  for (const shot of shots) {
    const now = Date.now();
    const at = shot.time === 'last-olympus-sunrise' ? lastSunrise(now) : new Date(now);
    const url = `http://localhost:${args.port}/?hud=0&hero=0&speed=0&at=${at.toISOString()}&${shot.query}${args.webgl ? '&webgl' : ''}`;
    const started = performance.now();
    await page.goto(url);
    await page.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 600e3 });
    await page.waitForFunction(() => (window.proto?.renderer.info.frame ?? 0) > 8 && document.getElementById('telemetry').textContent.includes('°'), null, { timeout: 600e3 });
    const text = await page.evaluate(() => {
      document.getElementById('stage').style.transition = 'none';
      const el = document.getElementById('telemetry');
      el.style.visibility = 'hidden';
      return el.textContent;
    });
    await page.waitForFunction((f) => window.proto.renderer.info.frame > f + 2, await page.evaluate(() => window.proto.renderer.info.frame), { timeout: 600e3 });
    // Software rendering on CI takes tens of seconds per frame, and a screenshot waits for the next one.
    const backend = await page.evaluate(() => {
      window.proto.renderer.setAnimationLoop(null);
      return window.proto.renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
    });
    const png = `${shot.id}.png`;
    await page.screenshot({ path: resolve(outDir, png), timeout: 300e3 });
    const { query, time, ...meta } = shot;
    frames.push({ ...meta, png, body: 'Mars', ...parseTelemetry(text), at: new Date(Math.floor(at.getTime() / 60e3) * 60e3).toISOString() });
    console.log(`${shot.id}: ${backend}, ${((performance.now() - started) / 1000).toFixed(1)} s, ${text}`);
  }
} finally {
  await browser.close();
  server.kill();
}

await writeFile(resolve(outDir, 'frames.json'), JSON.stringify(frames, null, 2) + '\n');
console.log(`Wrote ${frames.length} frames to ${outDir}`);
