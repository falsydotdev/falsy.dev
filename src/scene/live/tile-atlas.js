import * as THREE from 'three/webgpu';

// Array textures that hold one tile per layer. three.js only uploads whole array textures
// (and regenerates mips for every layer), so single layers are written through the backend.
export class LayerArray {
  /**
   * @param {THREE.WebGPURenderer} renderer
   * @param {{ size: number, layers: number, kind: 'color' | 'height' }} opts
   */
  constructor(renderer, { size, layers, kind }) {
    this.renderer = renderer;
    this.size = size;
    this.layers = layers;
    this.kind = kind;
    const color = kind === 'color';
    const tex = new THREE.DataArrayTexture(
      color ? new Uint8Array(4) : new Uint16Array(1),
      size,
      size,
      layers,
    );
    tex.format = color ? THREE.RGBAFormat : THREE.RedFormat;
    tex.type = color ? THREE.UnsignedByteType : THREE.HalfFloatType;
    if (color) tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    const levels = color ? Math.log2(size) + 1 : 1;
    // Placeholder entries only set the GPU mip count; data never goes through three.js.
    tex.mipmaps = Array.from({ length: levels > 1 ? levels : 0 }, (_, i) => ({ data: null, width: size >> i, height: size >> i }));
    tex.minFilter = color ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = color ? 8 : 1;
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
    const color = this.kind === 'color';
    const bpp = color ? 4 : 2;
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
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, mip, 0, 0, layer, s, s, 1, color ? gl.RGBA : gl.RED, color ? gl.UNSIGNED_BYTE : gl.HALF_FLOAT, data);
    });
  }

  dispose() {
    this.texture.dispose();
  }
}
