// Which tiles are open ocean: every height sample, border included, is water. The sea surface
// is flat there, so a renderer can skip the height tile and draw from an ancestor.
import type { TileKey } from './cube.ts';

/**
 * Stored in meta.json as `flatOcean`. `levels[L]` is a base64 bitset of 6·4^L bits, one per
 * tile, at bit (face·n + y)·n + x with n = 2^L, least significant bit of each byte first.
 */
export interface FlatOcean {
  levels: string[];
}

const bitIndex = (k: TileKey) => {
  const n = 2 ** k.level;
  return (k.face * n + k.y) * n + k.x;
};

const toBase64 = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

const decoded = new WeakMap<FlatOcean, Uint8Array[]>();

export function isFlatOcean(meta: FlatOcean | undefined, k: TileKey): boolean {
  if (!meta) return false;
  let levels = decoded.get(meta);
  if (!levels) decoded.set(meta, (levels = meta.levels.map(fromBase64)));
  const byte = levels[k.level]?.[bitIndex(k) >> 3];
  return byte !== undefined && ((byte >> (bitIndex(k) & 7)) & 1) === 1;
}

export class FlatOceanBuilder {
  private bits: Uint8Array[];

  constructor(maxLevel: number, from?: FlatOcean) {
    this.bits = Array.from({ length: maxLevel + 1 }, (_, level) => {
      const bytes = new Uint8Array(Math.ceil((6 * 4 ** level) / 8));
      const old = from?.levels[level];
      if (old) bytes.set(fromBase64(old).subarray(0, bytes.length));
      return bytes;
    });
  }

  set(k: TileKey, flat: boolean) {
    const i = bitIndex(k);
    const bytes = this.bits[k.level];
    if (flat) bytes[i >> 3] |= 1 << (i & 7);
    else bytes[i >> 3] &= ~(1 << (i & 7));
  }

  toJSON(): FlatOcean {
    return { levels: this.bits.map(toBase64) };
  }
}
