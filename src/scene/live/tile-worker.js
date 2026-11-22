// Decodes tiles off the main thread: colour as RGBA8 and mono as R8 with box-filtered mips, masked
// colour as an ImageBitmap, and heights as half-float km for an R16F array layer.
import { decodeHeights } from '../tiles/layout.ts';
import { halveLights } from '../tiles/lights-codec.ts';

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

function mipChain(pixels, size, channels = 4) {
  const levels = [pixels];
  let prev = pixels;
  const n = channels;
  for (let s = size >> 1; s >= 1; s >>= 1) {
    const next = new Uint8Array(s * s * n);
    const p = s * 2;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const a = (2 * y * p + 2 * x) * n;
        const b = a + p * n;
        const o = (y * s + x) * n;
        for (let c = 0; c < n; c++) next[o + c] = (prev[a + c] + prev[a + n + c] + prev[b + c] + prev[b + n + c] + 2) >> 2;
      }
    }
    levels.push(next);
    prev = next;
  }
  return levels;
}

async function decodeImage(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const rgba = new Uint8Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data.buffer);
  return { rgba, size: canvas.width, bytes: blob.size };
}

async function loadColor(url) {
  const img = await decodeImage(url);
  if (!img) return { missing: true, bytes: 0 };
  return { levels: mipChain(img.rgba, img.size), bytes: img.bytes };
}

// A 2D canvas stores premultiplied pixels, so decoding through one zeroes the colour wherever
// alpha is 0 (the sea, under a water mask). Masked tiles go to the GPU as the bitmap itself.
async function loadMasked(url) {
  const res = await fetch(url);
  if (!res.ok) return { missing: true, bytes: 0 };
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  return { bitmap, bytes: blob.size };
}

// Single-channel images (city lights) keep their first channel; their mips average light.
async function loadMono(url) {
  const img = await decodeImage(url);
  if (!img) return { missing: true, bytes: 0 };
  const mono = new Uint8Array(img.size * img.size);
  for (let i = 0; i < mono.length; i++) mono[i] = img.rgba[i * 4];
  const levels = [mono];
  for (let s = img.size; s > 1; s >>= 1) levels.push(halveLights(levels[levels.length - 1], s));
  return { levels, bytes: img.bytes };
}

async function loadHeight(url, shape) {
  // Only the shadow map has a shape. The first fade-in waits for it, so it goes ahead of the tile burst.
  const res = await fetch(url, shape ? { priority: 'high' } : undefined);
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

const LOADERS = { color: loadColor, masked: loadMasked, height: loadHeight, mono: loadMono };

self.onmessage = async ({ data: { id, format, url, shape } }) => {
  try {
    const out = await LOADERS[format](url, shape);
    const transfer = out.levels ? out.levels.map((l) => l.buffer) : out.data ? [out.data.buffer] : out.bitmap ? [out.bitmap] : [];
    self.postMessage({ id, format, ...out }, transfer);
  } catch (err) {
    self.postMessage({ id, format, error: String(err) });
  }
};
