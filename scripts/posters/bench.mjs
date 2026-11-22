// Measures what each scene layer costs the GPU per frame: renders one pinned poster shot with
// every `fx=` toggle in turn, in alternating rounds, and prints p10, median, and p90 frame times.
// Usage: node scripts/posters/bench.mjs [--url <running dev server>] [--shot mars-olympus] [--rounds 5]
//   [--samples 90] [--tier high] [--scale N] [--dpr 2] [--width 1440] [--height 900] [--repeat 8]
//   [--toggles shadows,bloom,shadows+bloom]
// Needs the local tiles, like render.mjs. Without --url it starts `astro dev` itself.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { FX_LAYERS, parseFx } from '../../src/scene/fx.ts';
import { isTierName } from '../../src/scene/quality.ts';
import { benchView, runOrder, summarise } from './bench-plan.mjs';

const { values: args } = parseArgs({
  options: {
    url: { type: 'string' },
    port: { type: 'string', default: '4350' },
    shot: { type: 'string', default: 'mars-olympus' },
    rounds: { type: 'string', default: '5' },
    samples: { type: 'string', default: '90' },
    tier: { type: 'string', default: 'high' },
    scale: { type: 'string' },
    dpr: { type: 'string', default: '2' },
    width: { type: 'string', default: '1440' },
    height: { type: 'string', default: '900' },
    toggles: { type: 'string' },
    repeat: { type: 'string', default: '8' },
  },
});

const root = resolve(import.meta.dirname, '../..');
const TIMEOUT = 120e3;
const rounds = Number(args.rounds);
const samples = Number(args.samples);
// The scene keeps its last 120 frame times.
if (!(samples > 0 && samples <= 120)) throw new Error('--samples must be 1 to 120');
if (!isTierName(args.tier)) throw new Error(`Unknown tier ${args.tier}`);
const viewport = { width: Number(args.width), height: Number(args.height) };
const view = benchView({ viewport, dpr: Number(args.dpr), scale: args.scale ? Number(args.scale) : undefined, tier: args.tier });

// `a+b` turns several layers off in one run. The first toggle, with nothing off, is the baseline.
const toggles = ['', ...(args.toggles?.split(',') ?? Object.keys(FX_LAYERS)).map((t) => t.split('+').join(','))];
for (const t of toggles.slice(1)) {
  if (parseFx(t).size !== t.split(',').length) throw new Error(`Unknown layer in "${t}"; known: ${Object.keys(FX_LAYERS).join(', ')}`);
}

const shot = JSON.parse(await readFile(resolve(import.meta.dirname, 'shots.json'), 'utf8')).find((s) => s.id === args.shot);
if (!shot) throw new Error(`No shot ${args.shot} in shots.json`);
const query = new URLSearchParams(shot.query);
query.set('t', '0');
query.set('tier', args.tier);
query.set('live', '1');
if (args.scale) query.set('scale', args.scale);
const repeat = Math.round(Number(args.repeat));
if (!(repeat >= 1 && repeat <= 64)) throw new Error('--repeat must be 1 to 64');
if (repeat > 1) query.set('bench', String(repeat));

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

const browser = await chromium.launch({ channel: 'chromium', args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'], headless: true });

async function run(fx) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: view.deviceScaleFactor });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  try {
    const params = new URLSearchParams(query);
    if (fx) params.set('fx', fx);
    await page.goto(`${base}/?${params}`);
    await page.waitForSelector('.sky.is-live', { timeout: TIMEOUT });
    // The same wait as render.mjs: every visible tile at full detail, so no uploads land in the timed frames.
    await page.waitForFunction(
      () => {
        const s = window.__falsyLive?.state;
        if (s?.shadow === 'failed') throw new Error('The shadow map failed to load.');
        return s && s.tiles.pending === 0 && s.tiles.inFlight === 0 && s.frames > 30 && s.earth !== 'loading' && s.shadow === 'ready';
      },
      null,
      { timeout: TIMEOUT, polling: 250 },
    );
    const info = await page.evaluate(() => {
      const live = window.__falsyLive;
      // Restarts the frame-time log; with a forced tier there's no governor for it to release.
      live.holdGovernor(false);
      const s = live.state;
      return { backend: s.backend, gpu: s.gpu, fx: s.fx, pixelRatio: s.pixelRatio, width: s.canvas.width, height: s.canvas.height };
    });
    if (info.backend !== 'WebGPU') throw new Error(`Expected WebGPU, got ${info.backend}; only WebGPU reports GPU time.`);
    const wanted = [...parseFx(fx)].sort().join(',');
    if ([...info.fx].sort().join(',') !== wanted) throw new Error(`Asked for fx=${fx}, but the scene turned off "${info.fx}"`);
    if (Math.abs(info.pixelRatio - view.pixelRatio) > 1e-6 || info.width !== view.width) {
      throw new Error(`Expected ${view.width}×${view.height} at ${view.pixelRatio}×, but the scene renders ${info.width}×${info.height} at ${info.pixelRatio}×`);
    }
    await page.waitForFunction((n) => window.__falsyLive.state.gpuLog.length >= n, samples, { timeout: TIMEOUT, polling: 100 });
    const log = await page.evaluate((n) => window.__falsyLive.state.gpuLog.slice(0, n), samples);
    return { fx, samples: log, info };
  } finally {
    await page.close();
  }
}

const fmt = (n) => n.toFixed(2).padStart(6);
const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n).toFixed(2);
const results = [];
try {
  // Discarded: the first load compiles shaders and fills the HTTP cache with tiles.
  const { info } = await run('');
  const order = runOrder(toggles, rounds);
  console.log(`Shot ${shot.id} (${shot.query}), tier ${args.tier}, t=0`);
  console.log(`GPU ${info.gpu ?? 'unknown'} (${info.backend}), viewport ${viewport.width}×${viewport.height} CSS px at ${view.deviceScaleFactor}× → canvas ${info.width}×${info.height} (${info.pixelRatio}×)`);
  console.log(`${rounds} rounds × ${toggles.length} toggles × ${samples} samples`);
  console.log(
    repeat > 1
      ? `Each sample renders the frame ${repeat}× back to back and divides submit-to-done time by ${repeat}, which spreads the fixed completion delay and keeps the GPU busier`
      : 'Each sample is one frame at the tier frame rate, submit-to-done, as the governor and scene_perf measure it: it includes the GPU waking from idle clocks',
  );
  for (const [i, fx] of order.entries()) {
    const r = await run(fx);
    results.push(r);
    const { p10, p50 } = summarise([r])[0];
    console.error(`  run ${i + 1}/${order.length} fx=${fx || '(none)'}: p10 ${p10} ms, median ${p50} ms`);
  }
} finally {
  await browser.close();
  server?.kill();
}

const rows = summarise(results);
const range = ([lo, hi]) => `${lo.toFixed(2)}–${hi.toFixed(2)}`;
console.log('');
console.log('fx=                 p10  median     p90     Δp10  Δmedian    Δp90   run p10      run median');
for (const r of rows) {
  const label = (r.fx || '(all on)').padEnd(16);
  console.log(`${label}${fmt(r.p10)}  ${fmt(r.p50)}  ${fmt(r.p90)}  ${signed(r.deltaP10).padStart(7)}  ${signed(r.deltaP50).padStart(7)}  ${signed(r.deltaP90).padStart(6)}   ${range(r.runP10).padEnd(11)}  ${range(r.runP50)}`);
}
const [lo, hi] = rows[0].runP50;
console.log('Milliseconds of GPU time per frame. Δ is against all layers on, so a layer costs about −Δ.');
console.log(`With all layers on, run medians spanned ${(hi - lo).toFixed(2)} ms, so a smaller Δmedian is within the noise.`);
