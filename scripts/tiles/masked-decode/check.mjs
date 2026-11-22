// Proves the browser path keeps colour under alpha 0. Encodes a tile with the bake's encoder
// (sea, alpha 0, on the left half), decodes it through the real tile worker and LayerArray in
// Chromium and WebKit on WebGPU and WebGL2, and compares every mip with a reference.
//   npx astro dev --port 4430 &  node scripts/tiles/masked-decode/check.mjs --url http://localhost:4430
// It also runs the plain colour path, which is expected to lose that colour.
import { chromium, webkit } from 'playwright';
import { createRequire } from 'node:module';
import { encodeTile } from '../colour-encode.mjs';

const sharp = createRequire(import.meta.url)('sharp');
const i = process.argv.indexOf('--url');
const BASE = i > 0 ? process.argv[i + 1] : 'http://localhost:4430';
const SIZE = 256;
const TOLERANCE = 3;

const pixels = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const o = (y * SIZE + x) * 4;
    pixels[o] = 30 + ((x * 3) >> 2);
    pixels[o + 1] = 60 + (y >> 1);
    pixels[o + 2] = 120 + ((x + y) >> 3);
    pixels[o + 3] = x < SIZE / 2 ? 0 : 255;
  }
}
const bytes = await encodeTile(pixels, 4).toBuffer();
const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer();

// Reference mips: each level averages the previous one in linear light, as an sRGB texture filters.
const toLinear = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (l) => Math.round(255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055));
const reference = [decoded];
for (let s = SIZE >> 1; s >= 1; s >>= 1) {
  const prev = reference[reference.length - 1];
  const next = new Uint8Array(s * s * 4);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const taps = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([dx, dy]) => ((2 * y + dy) * 2 * s + 2 * x + dx) * 4);
      for (let c = 0; c < 4; c++) {
        const mean = taps.reduce((a, t) => a + (c < 3 ? toLinear(prev[t + c]) : prev[t + c]), 0) / 4;
        next[(y * s + x) * 4 + c] = c < 3 ? toSrgb(mean) : Math.round(mean);
      }
    }
  }
  reference.push(next);
}

function compare(mips) {
  return mips.map((mip, level) => {
    const ref = reference[level];
    let worst = 0;
    let seaWorst = 0;
    for (let k = 0; k < ref.length; k++) {
      const d = Math.abs(mip[k] - ref[k]);
      worst = Math.max(worst, d);
      if (k % 4 < 3 && ref[k - (k % 4) + 3] === 0) seaWorst = Math.max(seaWorst, d);
    }
    return { level, worst, seaWorst };
  });
}

// The first import of the page module can make Vite optimise a dependency and reload the page.
async function evaluate(page, opts, attempt = 0) {
  await page.goto(`${BASE}/?live=0`, { waitUntil: 'networkidle' });
  try {
    return await page.evaluate(async (o) => (await import('/scripts/tiles/masked-decode/page.js')).run(o), opts);
  } catch (err) {
    if (attempt < 2 && /context was destroyed|navigation/.test(String(err))) return evaluate(page, opts, attempt + 1);
    throw err;
  }
}

let failed = false;
for (const [name, type, args] of [['Chromium', chromium, ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist']], ['WebKit', webkit, []]]) {
  const browser = await type.launch({ channel: name === 'Chromium' ? 'chromium' : undefined, args });
  for (const webgl of [false, true]) {
    for (const format of ['masked', 'color']) {
      const page = await browser.newPage();
      let line;
      try {
        const { backend, mips } = await evaluate(page, { bytes: [...bytes], webgl, format });
        const rows = compare(mips);
        const worst = Math.max(...rows.map((r) => r.worst));
        const sea = Math.max(...rows.map((r) => r.seaWorst));
        const ok = format === 'masked' ? worst <= TOLERANCE : true;
        if (!ok) failed = true;
        line = `${format === 'color' ? 'info' : ok ? 'ok  ' : 'FAIL'} ${name} ${backend} ${format}: worst channel delta ${worst} over ${rows.length} mips, ${sea} under alpha 0 (mip 0 ${rows[0].worst})`;
        if (backend !== (webgl ? 'WebGL2' : 'WebGPU')) line += ' [fell back]';
      } catch (err) {
        failed = failed || format === 'masked';
        line = `${format === 'masked' ? 'FAIL' : 'n/a '} ${name} ${webgl ? 'WebGL2' : 'WebGPU'} ${format}: ${String(err.message ?? err).split('\n')[0]}`;
      }
      console.log(line);
      await page.close();
    }
  }
  await browser.close();
}
process.exit(failed ? 1 : 0);
