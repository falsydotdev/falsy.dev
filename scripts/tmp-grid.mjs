import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { lightOf } from '../src/scene/tiles/lights-codec.ts';
const dir = process.env.FALSY_DATA_DIR + '/sources/earth-mosaic/';
const h = JSON.parse(readFileSync(dir + 'lights-coarse.json')); const bin = readFileSync(dir + 'lights-coarse.bin');
for (const cell of [1, 2]) {
  const cols = 360 / cell, rows = 180 / cell, per = h.w / cols;
  const mean = new Float64Array(cols * rows);
  for (let y = 0; y < h.h; y++) { const r = Math.floor(y / per); for (let x = 0; x < h.w; x++) mean[r * cols + Math.floor(x / per)] += lightOf(bin[y * h.w + x]); }
  for (let i = 0; i < mean.length; i++) mean[i] /= per * per;
  const s = [...mean].sort((a, b) => a - b); const max = s[s.length - 1];
  const at = (lat, lon) => mean[Math.floor((90 - lat) / cell) * cols + Math.floor((lon + 180) / cell)];
  console.log(`cell ${cell}°: max ${max.toFixed(4)} p50 ${s[s.length >> 1].toExponential(2)} p90 ${s[Math.floor(s.length * 0.9)].toExponential(2)} p99 ${s[Math.floor(s.length * 0.99)].toFixed(4)} zero ${(s.filter((v) => v === 0).length / s.length * 100).toFixed(0)}%`);
  console.log('  NL', at(52.3, 5.3).toFixed(4), 'Ruhr', at(51.5, 7.2).toFixed(4), 'Paris', at(48.85, 2.35).toFixed(4), 'Tokyo', at(35.7, 139.7).toFixed(4), 'Sahara', at(23, 12).toExponential(2), 'Pacific', at(0, -150).toExponential(2), 'Siberia', at(65, 100).toExponential(2), 'N Sea', at(56, 3).toExponential(2), 'Cairo', at(30.05, 31.25).toFixed(4));
  for (const p of [3, 4]) {
    const b = Uint8Array.from(mean, (v) => Math.round(255 * v ** (1 / p)));
    const b64 = Buffer.from(b).toString('base64');
    console.log(`  pow 1/${p}: raw ${b.length} gz ${gzipSync(b).length} b64 ${b64.length} b64gz ${gzipSync(b64).length} nonzero ${b.filter(Boolean).length}`);
  }
}
