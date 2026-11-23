import * as THREE from 'three/webgpu';

// Per tile-layer format: colour is sRGB RGBA8 with mips, height is R16F km without, mono is R8 with mips.
// Masked colour is stored like colour but arrives as an ImageBitmap (see writeImage).
const COLOR = { empty: () => new Uint8Array(4), format: THREE.RGBAFormat, type: THREE.UnsignedByteType, srgb: true, bpp: 4, mips: true, anisotropy: 8, gl: ['RGBA', 'UNSIGNED_BYTE'] };
const FORMATS = {
  color: COLOR,
  masked: COLOR,
  height: { empty: () => new Uint16Array(1), format: THREE.RedFormat, type: THREE.HalfFloatType, srgb: false, bpp: 2, mips: false, anisotropy: 1, gl: ['RED', 'HALF_FLOAT'] },
  mono: { empty: () => new Uint8Array(1), format: THREE.RedFormat, type: THREE.UnsignedByteType, srgb: false, bpp: 1, mips: true, anisotropy: 8, gl: ['RED', 'UNSIGNED_BYTE'] },
};

// Array textures that hold one tile per layer. three.js only uploads whole array textures
// (and regenerates mips for every layer), so single layers are written through the backend.
export class LayerArray {
  /**
   * @param {THREE.WebGPURenderer} renderer
   * @param {{ size: number, layers: number, format: 'color' | 'masked' | 'height' | 'mono' }} opts
   */
  constructor(renderer, { size, layers, format }) {
    this.renderer = renderer;
    this.size = size;
    this.layers = layers;
    const f = (this.format = FORMATS[format]);
    const tex = new THREE.DataArrayTexture(f.empty(), size, size, layers);
    tex.format = f.format;
    tex.type = f.type;
    if (f.srgb) tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    const levels = f.mips ? Math.log2(size) + 1 : 1;
    // Placeholder entries only set the GPU mip count; data never goes through three.js.
    tex.mipmaps = Array.from({ length: levels > 1 ? levels : 0 }, (_, i) => ({ data: null, width: size >> i, height: size >> i }));
    tex.minFilter = f.mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = f.anisotropy;
    tex.source.dataReady = false;
    tex.needsUpdate = true;
    renderer.initTexture(tex);
    this.texture = tex;
    this.free = Array.from({ length: layers }, (_, i) => layers - 1 - i);
  }

  alloc() {
    return this.free.pop() ?? -1;
  }

  release(layer) {
    this.free.push(layer);
  }

  /** @param {number} layer @param {ArrayBufferView[]} levels mip 0 first */
  write(layer, levels) {
    const backend = this.renderer.backend;
    const { bpp, gl: [glFormat, glType] } = this.format;
    if (backend.isWebGPUBackend) {
      const gpuTexture = backend.get(this.texture).texture;
      levels.forEach((data, mip) => {
        const s = this.size >> mip;
        backend.device.queue.writeTexture({ texture: gpuTexture, mipLevel: mip, origin: { x: 0, y: 0, z: layer } }, data, { bytesPerRow: s * bpp, rowsPerImage: s }, { width: s, height: s, depthOrArrayLayers: 1 });
      });
      return;
    }
    const { gl } = backend;
    const { textureGPU } = backend.get(this.texture);
    backend.state.bindTexture(gl.TEXTURE_2D_ARRAY, textureGPU);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    levels.forEach((data, mip) => {
      const s = this.size >> mip;
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, mip, 0, 0, layer, s, s, 1, gl[glFormat], gl[glType], data);
    });
  }

  /**
   * Uploads an RGBA ImageBitmap to mip 0 of `layer` with alpha left unpremultiplied, then
   * builds that layer's mips on the GPU. Closes the bitmap.
   * @param {number} layer @param {ImageBitmap} bitmap
   */
  writeImage(layer, bitmap) {
    const backend = this.renderer.backend;
    const levels = Math.max(1, this.texture.mipmaps.length);
    if (backend.isWebGPUBackend) {
      const { device } = backend;
      const gpuTexture = backend.get(this.texture).texture;
      device.queue.copyExternalImageToTexture({ source: bitmap }, { texture: gpuTexture, origin: { x: 0, y: 0, z: layer }, premultipliedAlpha: false }, { width: this.size, height: this.size });
      bitmap.close();
      gpuDownsample(device, gpuTexture, layer, levels);
      return;
    }
    const { gl, state } = backend;
    const { textureGPU } = backend.get(this.texture);
    state.bindTexture(gl.TEXTURE_2D_ARRAY, textureGPU);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, this.size, this.size, 1, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
    bitmap.close();
    // Mips by linear blits, one level into the next, through state's caches so three stays in sync.
    this.blitTargets ??= [gl.createFramebuffer(), gl.createFramebuffer()];
    const [read, draw] = this.blitTargets;
    state.disable(gl.SCISSOR_TEST);
    state.bindFramebuffer(gl.READ_FRAMEBUFFER, read);
    state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, draw);
    for (let mip = 1; mip < levels; mip++) {
      const s = this.size >> (mip - 1);
      gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, textureGPU, mip - 1, layer);
      gl.framebufferTextureLayer(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, textureGPU, mip, layer);
      gl.blitFramebuffer(0, 0, s, s, 0, 0, s >> 1, s >> 1, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    }
    state.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  }

  dispose() {
    this.texture.dispose();
  }
}

// A linear tap at the shared corner of each 2×2 block averages it; sampling through an sRGB view
// averages in linear light.
const DOWNSAMPLE_WGSL = `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
struct V { @builtin(position) p: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> V {
  let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return V(vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0), uv);
}
@fragment fn fs(v: V) -> @location(0) vec4f { return textureSampleLevel(src, smp, v.uv, 0.0); }`;

const downsamplers = new WeakMap();

function gpuDownsample(device, texture, layer, levels) {
  let d = downsamplers.get(device)?.[texture.format];
  if (!d) {
    const module = device.createShaderModule({ code: DOWNSAMPLE_WGSL });
    const pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format: texture.format }] } });
    d = { pipeline, sampler: device.createSampler({ minFilter: 'linear', magFilter: 'linear' }) };
    downsamplers.set(device, { ...downsamplers.get(device), [texture.format]: d });
  }
  const encoder = device.createCommandEncoder();
  const view = (mip) => texture.createView({ dimension: '2d', baseMipLevel: mip, mipLevelCount: 1, baseArrayLayer: layer, arrayLayerCount: 1 });
  for (let mip = 1; mip < levels; mip++) {
    const bind = device.createBindGroup({ layout: d.pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: view(mip - 1) }, { binding: 1, resource: d.sampler }] });
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: view(mip), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
    pass.setPipeline(d.pipeline);
    pass.setBindGroup(0, bind);
    pass.draw(3);
    pass.end();
  }
  device.queue.submit([encoder.finish()]);
}
