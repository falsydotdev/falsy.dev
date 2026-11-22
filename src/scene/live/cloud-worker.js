// Fetches a cloud set (pointer JSON, then its AVIF) and decodes it off the main thread into one
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

self.onmessage = async ({ data: { url, width, height } }) => {
  try {
    const pointerUrl = new URL(url, self.location.href);
    const res = await fetch(pointerUrl);
    if (!res.ok) throw new Error(`${res.status} for ${pointerUrl}`);
    const meta = await res.json();
    const imageUrl = new URL(meta.path, pointerUrl);
    const img = await fetch(imageUrl);
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
    const levels = mipChain(plane, width, height);
    self.postMessage({ meta, levels, bytes: blob.size + JSON.stringify(meta).length }, levels.map((l) => l.data.buffer));
  } catch (err) {
    self.postMessage({ error: String(err) });
  }
};
