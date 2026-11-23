import { describe, expect, it } from 'vitest';
import { toneReflectance } from '../../scripts/tiles/earth/sentinel.ts';
import { LOW_RES_TILES, overlayRow, lowResKey, lowResTilesFor, rowLat, sampleBilinear, sentinelWeight, sourceWindow, sourceX, sourceY, targetWindow } from '../../scripts/tiles/earth/lowres.ts';

const tile = (name: string) => LOW_RES_TILES.find((t) => t.name === name)!;
// The Netherlands test region's colour raster, at 1/240°.
const REGION = { w: 4008, h: 2904, west: 0, north: 56.4, east: 16.7, south: 44.3 };

describe('Sentinel-2 low-resolution mosaic tiles', () => {
  it('tiles the globe in 50 squares of 36°, named by their south-west corner', () => {
    expect(LOW_RES_TILES).toHaveLength(50);
    expect(LOW_RES_TILES.find((t) => t.name === 'N54E000')).toMatchObject({ west: 0, south: 54, east: 36, north: 90 });
    expect(LOW_RES_TILES.find((t) => t.name === 'S90W180')).toMatchObject({ west: -180, south: -90, east: -144, north: -54 });
    expect(LOW_RES_TILES.find((t) => t.name === 'S18E144')).toMatchObject({ west: 144, south: -18, east: 180, north: 18 });
  });

  it('picks only the tiles a raster crosses, not neighbours it only touches', () => {
    expect(lowResTilesFor({ west: 0, south: 44.3, east: 16.7, north: 56.4 }).map((t) => t.name)).toEqual(['N54E000', 'N18E000']);
    expect(lowResTilesFor({ west: 0, south: 18, east: 36, north: 54 }).map((t) => t.name)).toEqual(['N18E000']);
    expect(lowResTilesFor({ west: -180, south: -90, east: 180, north: 90 })).toHaveLength(50);
  });

  it('keys each band under the quarter’s first month', () => {
    expect(lowResKey({ year: 2025, quarter: 4, firstMonth: '10' }, 'N54E000', 'B04')).toBe(
      'eodata/Global-Mosaics/Sentinel-2/S2MSI_L3__MCQ_LR/2025/10/01/Sentinel-2_mosaic_2025_Q4_N54E000_low_resolution/B04.tif',
    );
  });
});

describe('mapping colour raster pixels onto tile samples', () => {
  it('gives each raster pixel to the tile that holds its centre', () => {
    expect(targetWindow(REGION, tile('N54E000'))).toEqual({ x0: 0, y0: 0, x1: 4008, y1: 576 });
    expect(targetWindow(REGION, tile('N18E000'))).toEqual({ x0: 0, y0: 576, x1: 4008, y1: 2904 });
  });

  it('keeps both bilinear taps inside one tile on each side of a seam', () => {
    // Rows 575 and 576 straddle 54°N, 1/480° either side of it.
    expect(sourceY(REGION, tile('N54E000'), 575)).toBeCloseTo(9998.921, 3);
    expect(sourceY(REGION, tile('N18E000'), 576)).toBeCloseTo(0.0787, 3);
    expect(sourceX(REGION, tile('N18E000'), 0)).toBeCloseTo(0.0787, 3);
  });

  it('reads only the samples the pixels need, plus the second tap', () => {
    expect(sourceWindow(REGION, tile('N54E000'), targetWindow(REGION, tile('N54E000')))).toEqual({ x0: 0, y0: 9333, x1: 4639, y1: 10000 });
  });
});

describe('bilinear resampling with nodata', () => {
  const ND = -32768;
  // A 3×2 window of samples, row-major.
  const band = Int16Array.from([100, 200, 300, 500, 600, 700]);
  const src = { data: band, w: 3, h: 2 };

  it('blends the four samples around a point', () => {
    expect(sampleBilinear(src, 0, 0)).toBe(100);
    expect(sampleBilinear(src, 0.5, 0)).toBe(150);
    expect(sampleBilinear(src, 0.5, 0.5)).toBe(350);
    expect(sampleBilinear(src, 1.25, 1)).toBe(625);
  });

  it('weighs only the samples that hold data', () => {
    const holed = { ...src, data: Int16Array.from([100, ND, 300, 500, 600, 700]) };
    // Taps 100 (0.25), 500 (0.25), 600 (0.25) remain once the nodata tap drops out.
    expect(sampleBilinear(holed, 0.5, 0.5)).toBeCloseTo(400, 6);
  });

  it('returns null where every tap is nodata', () => {
    const empty = { ...src, data: Int16Array.from([ND, ND, 300, ND, ND, 700]) };
    expect(sampleBilinear(empty, 0.5, 0.5)).toBeNull();
    expect(sampleBilinear(empty, 0, 0)).toBeNull();
  });

  it('clamps at the window edge instead of reading past it', () => {
    expect(sampleBilinear(src, 2.4, 1.3)).toBe(700);
    expect(sampleBilinear(src, -0.3, -0.2)).toBe(100);
  });
});

describe('overlaying one raster row, land only', () => {
  const ND = -32768;
  const flat = (v: number) => ({ data: Int16Array.from([v, v, v, v]), w: 2, h: 2 });
  const red = flat(800), green = flat(700), blue = flat(500);
  const fxs = Float64Array.from([0.2, 0.5, 0.8]);

  it('tones land pixels and leaves water to the renderer', () => {
    const out = [Uint8Array.from([1, 1, 1]), Uint8Array.from([2, 2, 2]), Uint8Array.from([3, 3, 3])];
    const written = overlayRow([red, green, blue], 0.5, fxs, Uint8Array.from([255, 0, 255]), out);
    expect(written).toBe(2);
    expect([...out[0]]).toEqual([toneReflectance(800, 0), 1, toneReflectance(800, 0)]);
    expect([...out[1]]).toEqual([toneReflectance(700, 1), 2, toneReflectance(700, 1)]);
    expect([...out[2]]).toEqual([toneReflectance(500, 2), 3, toneReflectance(500, 2)]);
  });

  it('keeps Blue Marble where any band has no data', () => {
    const out = [new Uint8Array(3).fill(9), new Uint8Array(3).fill(9), new Uint8Array(3).fill(9)];
    expect(overlayRow([red, green, flat(ND)], 0.5, fxs, new Uint8Array(3).fill(255), out)).toBe(0);
    expect(out.every((row) => row.every((v) => v === 9))).toBe(true);
  });

  it('blends toward Sentinel-2 by the row weight, from the Blue Marble already in the row', () => {
    // DN 0 tones to black in every band, so the result is Blue Marble scaled by 1 − weight.
    const black = flat(0);
    const out = [Uint8Array.from([200, 0, 200]), Uint8Array.from([100, 0, 100]), Uint8Array.from([40, 0, 40])];
    expect(overlayRow([black, black, black], 0.5, fxs, Uint8Array.from([255, 0, 255]), out, 0.25)).toBe(2);
    expect([...out[0]]).toEqual([150, 0, 150]);
    expect([...out[1]]).toEqual([75, 0, 75]);
    expect([...out[2]]).toEqual([30, 0, 30]);
  });

  it('writes nothing at zero weight', () => {
    const out = [new Uint8Array(3).fill(9), new Uint8Array(3).fill(9), new Uint8Array(3).fill(9)];
    expect(overlayRow([red, green, blue], 0.5, fxs, new Uint8Array(3).fill(255), out, 0)).toBe(0);
    expect(out.every((row) => row.every((v) => v === 9))).toBe(true);
  });
});

describe('fading Sentinel-2 out toward its polar coverage edges', () => {
  it('keeps full weight well inside coverage', () => {
    for (const lat of [-69, -60, 0, 54, 75.9]) expect(sentinelWeight(lat)).toBe(1);
  });

  it('reaches zero before the measured edges, 82.81°S and the 78.5–80.5°N cap', () => {
    for (const lat of [-82.75, -82.9, -90, 78.5, 80, 90]) expect(sentinelWeight(lat)).toBe(0);
  });

  it('falls monotonically across each ramp', () => {
    const north = Array.from({ length: 101 }, (_, i) => sentinelWeight(75 + i * 0.04));
    const south = Array.from({ length: 101 }, (_, i) => sentinelWeight(-69 - i * 0.14));
    for (const ramp of [north, south]) {
      for (let i = 1; i < ramp.length; i++) expect(ramp[i]).toBeLessThanOrEqual(ramp[i - 1]);
      expect(ramp.some((w) => w > 0 && w < 1)).toBe(true);
    }
  });

  it('weighs a raster row by the latitude of its centre', () => {
    const globe = { w: 86400, h: 43200, west: -180, north: 90, east: 180, south: -90 };
    expect(rowLat(globe, 0)).toBeCloseTo(89.997917, 6);
    expect(rowLat(globe, 43199)).toBeCloseTo(-89.997917, 6);
    expect(rowLat(REGION, 576)).toBeCloseTo(53.997917, 6);
  });
});
