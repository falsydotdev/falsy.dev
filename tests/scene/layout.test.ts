import { describe, expect, it } from 'vitest';
import { HEIGHT_SIZE, TILES, decodeHeights, encodeHeights } from '../../src/scene/tiles/layout';

describe('height tile codec', () => {
  it('round-trips heights to within half a storage step across the full Mars range', () => {
    const n = HEIGHT_SIZE;
    const metres = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) metres[j * n + i] = 6000 * Math.sin(i / 7) * Math.cos(j / 11) + (i === 40 ? 21229 : j === 3 ? -8200 : 0);
    }
    const back = decodeHeights(encodeHeights(metres));
    for (let k = 0; k < metres.length; k++) expect(Math.abs(back[k] - metres[k])).toBeLessThanOrEqual(TILES.heightStepM / 2 + 1e-3);
  });
});
