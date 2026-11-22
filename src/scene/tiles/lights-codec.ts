// City-light tiles store Black Marble's display grey as published. Averaging greys would dim a
// city that shrinks below a texel, so coarser levels (bake parents, mips) average light instead.
export const LIGHTS_GAMMA = 2.2;
const GAMMA = LIGHTS_GAMMA;
const LIGHT = Float32Array.from({ length: 256 }, (_, v) => (v / 255) ** GAMMA);

/** Light of a stored grey level, 0 to 1 (full white). */
export const lightOf = (grey: number): number => LIGHT[grey];

/** The grey level that stores light `l` (0 to 1). */
export const greyOf = (l: number): number => Math.round(255 * Math.min(1, Math.max(0, l)) ** (1 / GAMMA));

/** A square single-channel image of side `size` halved by 2×2 blocks, averaging light. */
export function halveLights(px: Uint8Array, size: number): Uint8Array {
  const s = size >> 1;
  const out = new Uint8Array(s * s);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const a = 2 * y * size + 2 * x;
      const b = a + size;
      out[y * s + x] = greyOf((LIGHT[px[a]] + LIGHT[px[a + 1]] + LIGHT[px[b]] + LIGHT[px[b + 1]]) / 4);
    }
  }
  return out;
}
