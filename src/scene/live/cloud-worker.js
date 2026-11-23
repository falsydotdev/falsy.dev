// Fetches a cloud set (its metadata, then its AVIF) and decodes it off the main thread into one
// single-channel plane with a box-filtered mip chain. The AVIF stores opacity in 3 equal channels.

function mipChain(plane, width, height) {
  const levels = [{ data: plane, width, height }];
  let prev = levels[0];
  while (prev.width > 1 || prev.height > 1) {
    const w = Math.max(1, prev.width >> 1);
    const h = Math.max(1, prev.height >> 1);
    const next = new Uint8Array(w * h);
    const src = prev.data;
    const pw = prev.width;
    for (let y = 0; y < h; y++) {
      const y0 = Math.min(2 * y, prev.height - 1) * pw;
      const y1 = Math.min(2 * y + 1, prev.height - 1) * pw;
      for (let x = 0; x < w; x++) {
        const x0 = Math.min(2 * x, pw - 1);
        const x1 = Math.min(2 * x + 1, pw - 1);
        next[y * w + x] = (src[y0 + x0] + src[y0 + x1] + src[y1 + x0] + src[y1 + x1] + 2) >> 2;
      }
    }
    prev = { data: next, width: w, height: h };
    levels.push(prev);
  }
  return levels;
}

// A dead live source must not hold the scene's readiness wait, which posters and the bench share.
// The static map is the last resort, so it gets as long as it takes.
const LIVE_TIMEOUT_MS = { meta: 5000, image: 30000 };
const signal = (live, kind) => (live ? AbortSignal.timeout(LIVE_TIMEOUT_MS[kind]) : undefined);

async function fetchMeta(url, live) {
  const res = await fetch(url, { signal: signal(live, 'meta') });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.json();
}

async function decode(meta, metaUrl, live, width, height) {
  // A dated set's meta.json sits beside its clouds.avif; pointers name their texture.
  const imageUrl = new URL(meta.path ?? 'clouds.avif', metaUrl);
  const img = await fetch(imageUrl, { signal: signal(live, 'image') });
  if (!img.ok) throw new Error(`${img.status} for ${imageUrl}`);
  const blob = await img.blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  if (bmp.width !== width || bmp.height !== height) throw new Error(`Cloud map is ${bmp.width}×${bmp.height}, expected ${width}×${height}`);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const plane = new Uint8Array(width * height);
  for (let i = 0; i < plane.length; i++) plane[i] = rgba[i * 4];
  return { levels: mipChain(plane, width, height), bytes: blob.size + JSON.stringify(meta).length };
}

// Tries each candidate set in order and decodes the first that loads. The live ones' metadata is
// fetched side by side, since a pinned moment probes several hours.
self.onmessage = async ({ data: { candidates, width, height } }) => {
  const urls = candidates.map((c) => new URL(c.url, self.location.href));
  const metas = candidates.map((c, i) => (c.source === 'live' ? fetchMeta(urls[i], true) : null));
  for (const m of metas) m?.catch(() => {});
  const errors = [];
  for (let i = 0; i < candidates.length; i++) {
    try {
      const live = candidates[i].source === 'live';
      const meta = await (metas[i] ?? fetchMeta(urls[i], live));
      const { levels, bytes } = await decode(meta, urls[i], live, width, height);
      self.postMessage({ index: i, meta, levels, bytes }, levels.map((l) => l.data.buffer));
      return;
    } catch (err) {
      errors.push(String(err));
    }
  }
  self.postMessage({ error: errors.join('; ') || 'no cloud sets to try' });
};
