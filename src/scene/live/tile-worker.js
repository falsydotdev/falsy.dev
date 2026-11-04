// Fetches and decodes tiles off the main thread. Colour comes back as RGBA8 with a box-filtered
// mip chain; heights come back as half floats in km, ready for an R16F array layer.
import { decodeHeights } from '../tiles/layout.ts';

const toHalf = (() => {
  const f32 = new Float32Array(1);
  const u32 = new Uint32Array(f32.buffer);
  return (v) => {
    f32[0] = v;
    const x = u32[0];
    const sign = (x >>> 16) & 0x8000;
    const exp = ((x >>> 23) & 0xff) - 127 + 15;
    if (exp <= 0) return sign;
    if (exp >= 31) return sign | 0x7c00;
    return sign | (exp << 10) | ((x >>> 13) & 0x3ff);
  };
})();

function mipChain(rgba, size) {
  const levels = [rgba];
  let prev = rgba;
  for (let s = size >> 1; s >= 1; s >>= 1) {
    const next = new Uint8Array(s * s * 4);
    const p = s * 2;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const a = (2 * y * p + 2 * x) * 4;
        const b = a + p * 4;
        const o = (y * s + x) * 4;
        for (let c = 0; c < 4; c++) next[o + c] = (prev[a + c] + prev[a + 4 + c] + prev[b + c] + prev[b + 4 + c] + 2) >> 2;
      }
    }
    levels.push(next);
    prev = next;
  }
  return levels;
}

async function loadColor(url) {
  const res = await fetch(url);
  if (!res.ok) return { missing: true, bytes: 0 };
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const rgba = new Uint8Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data.buffer);
  return { levels: mipChain(rgba, canvas.width), bytes: blob.size };
}

async function loadHeight(url, shape) {
  const res = await fetch(url);
  if (!res.ok) return { missing: true, bytes: 0 };
  const packed = new Uint8Array(await res.arrayBuffer());
  const raw = new Uint8Array(await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  const metres = shape ? decodeHeights(raw, shape.width, shape.height, shape.stepM) : decodeHeights(raw);
  const half = new Uint16Array(metres.length);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < metres.length; i++) {
    half[i] = toHalf(metres[i] / 1000);
    if (metres[i] < min) min = metres[i];
    if (metres[i] > max) max = metres[i];
  }
  return { data: half, minKm: min / 1000, maxKm: max / 1000, bytes: packed.length };
}

self.onmessage = async ({ data: { id, kind, url, shape } }) => {
  try {
    const out = kind === 'color' ? await loadColor(url) : await loadHeight(url, shape);
    const transfer = out.levels ? out.levels.map((l) => l.buffer) : out.data ? [out.data.buffer] : [];
    self.postMessage({ id, kind, ...out }, transfer);
  } catch (err) {
    self.postMessage({ id, kind, error: String(err) });
  }
};
