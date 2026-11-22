import * as THREE from 'three/webgpu';

// Per tile-layer format: colour is sRGB RGBA8 with mips, height is R16F km without, mono is R8 with mips.
const FORMATS = {
  color: { empty: () => new Uint8Array(4), format: THREE.RGBAFormat, type: THREE.UnsignedByteType, srgb: true, bpp: 4, mips: true, anisotropy: 8, gl: ['RGBA', 'UNSIGNED_BYTE'] },
  height: { empty: () => new Uint16Array(1), format: THREE.RedFormat, type: THREE.HalfFloatType, srgb: false, bpp: 2, mips: false, anisotropy: 1, gl: ['RED', 'HALF_FLOAT'] },
  mono: { empty: () => new Uint8Array(1), format: THREE.RedFormat, type: THREE.UnsignedByteType, srgb: false, bpp: 1, mips: true, anisotropy: 8, gl: ['RED', 'UNSIGNED_BYTE'] },
};

// Array textures that hold one tile per layer. three.js only uploads whole array textures
// (and regenerates mips for every layer), so single layers are written through the backend.
export class LayerArray {
  /**
   * @param {THREE.WebGPURenderer} renderer
   * @param {{ size: number, layers: number, format: 'color' | 'height' | 'mono' }} opts
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

  dispose() {
    this.texture.dispose();
  }
}
