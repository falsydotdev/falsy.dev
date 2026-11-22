// Loaded into a dev-server page by check.mjs: decodes one tile through the real tile worker,
// writes it through the real LayerArray, and reads every mip of that layer back.
import * as THREE from 'three/webgpu';
import { LayerArray } from '../../../src/scene/live/tile-atlas.js';

const SIZE = 256;
const LAYER = 1;

async function readWebGPU(renderer, atlas, levels) {
  const { device } = renderer.backend;
  const texture = renderer.backend.get(atlas.texture).texture;
  const mips = [];
  for (let mip = 0; mip < levels; mip++) {
    const s = SIZE >> mip;
    const bytesPerRow = Math.ceil((s * 4) / 256) * 256;
    const buffer = device.createBuffer({ size: bytesPerRow * s, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture, mipLevel: mip, origin: { x: 0, y: 0, z: LAYER } }, { buffer, bytesPerRow }, { width: s, height: s });
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const padded = new Uint8Array(buffer.getMappedRange());
    const out = new Uint8Array(s * s * 4);
    for (let y = 0; y < s; y++) out.set(padded.subarray(y * bytesPerRow, y * bytesPerRow + s * 4), y * s * 4);
    buffer.unmap();
    mips.push(Array.from(out));
  }
  return mips;
}

function readWebGL(renderer, atlas, levels) {
  const { gl } = renderer.backend;
  const { textureGPU } = renderer.backend.get(atlas.texture);
  const fb = gl.createFramebuffer();
  renderer.backend.state.bindFramebuffer(gl.READ_FRAMEBUFFER, fb);
  const mips = [];
  for (let mip = 0; mip < levels; mip++) {
    const s = SIZE >> mip;
    gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, textureGPU, mip, LAYER);
    const out = new Uint8Array(s * s * 4);
    gl.readPixels(0, 0, s, s, gl.RGBA, gl.UNSIGNED_BYTE, out);
    mips.push(Array.from(out));
  }
  renderer.backend.state.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  const error = gl.getError();
  if (error) throw new Error(`WebGL error ${error}`);
  return mips;
}

export async function run({ bytes, webgl, format }) {
  const renderer = new THREE.WebGPURenderer({ forceWebGL: webgl, antialias: false });
  await renderer.init();
  const backend = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
  const device = renderer.backend.device;
  device?.pushErrorScope('validation');
  const atlas = new LayerArray(renderer, { size: SIZE, layers: 2, format });
  const worker = new Worker(new URL('../../../src/scene/live/tile-worker.js', import.meta.url), { type: 'module' });
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/avif' }));
  const out = await new Promise((resolve) => {
    worker.onmessage = (e) => resolve(e.data);
    worker.postMessage({ id: 'check', format, url });
  });
  worker.terminate();
  if (out.error) throw new Error(out.error);
  if (out.bitmap) atlas.writeImage(LAYER, out.bitmap);
  else atlas.write(LAYER, out.levels);
  const levels = Math.log2(SIZE) + 1;
  const mips = backend === 'WebGPU' ? await readWebGPU(renderer, atlas, levels) : readWebGL(renderer, atlas, levels);
  const gpuError = await device?.popErrorScope();
  if (gpuError) throw new Error(`GPU validation error: ${gpuError.message}`);
  atlas.dispose();
  renderer.dispose();
  return { backend, mips };
}
