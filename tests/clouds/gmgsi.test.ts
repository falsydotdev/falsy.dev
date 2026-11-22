import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error The cloud job is plain JS outside the type-checked tree.
import { readGmgsi } from '../../clouds/container/gmgsi.js';

const fixture = readFileSync(new URL('./fixtures/gmgsi-lw-stride16.nc', import.meta.url));

describe('GMGSI decoding', () => {
  it('reads the valid time, the Mercator rows, and the longitudes', async () => {
    const grid = await readGmgsi(fixture);
    expect(grid.valid.toISOString()).toBe('2026-11-22T11:00:00.000Z');
    expect([grid.width, grid.height]).toEqual([313, 188]);
    expect(grid.lat[0]).toBeCloseTo(72.7154, 3);
    expect(grid.lat[grid.height - 1]).toBeLessThan(-71);
    expect(grid.lon[1]).toBeCloseTo(-180.0004 + 16 * 0.072009, 2);
  });

  it('marks fill as no data and keeps counts as bytes', async () => {
    const grid = await readGmgsi(fixture);
    const row0 = grid.counts.subarray(0, grid.width);
    expect(row0.every((v: number) => v === 0)).toBe(true);
    const rest = grid.counts.subarray(grid.width);
    const observed = rest.filter((v: number) => v > 0).length;
    expect(observed / rest.length).toBeGreaterThan(0.95);
  });

  it('treats flagged pixels as no data (the flag-20 block is saturated, not cloud)', async () => {
    const grid = await readGmgsi(fixture);
    expect(grid.counts.includes(255)).toBe(false);
  });
});
