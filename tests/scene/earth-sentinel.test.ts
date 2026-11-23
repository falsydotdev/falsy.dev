import { describe, expect, it } from 'vitest';
import { bmngMonth, colorPeriod, mosaicQuarter, TONE, toneReflectance } from '../../scripts/tiles/earth/sentinel.ts';

describe('Sentinel-2 tone curve', () => {
  const RED = 0, GREEN = 1, BLUE = 2;

  it('lifts farmland reflectance to Blue Marble brightness, per channel, below the shoulder', () => {
    expect(toneReflectance(0, GREEN)).toBe(0);
    expect(toneReflectance(800, GREEN)).toBe(Math.round(Math.pow(0.08 * TONE.gain[GREEN], 1 / TONE.gamma) * 255));
    expect(toneReflectance(800, GREEN)!).toBeGreaterThan(Math.round(0.08 * 2.5 * 255));
  });

  it('warms the colour, since surface reflectance reads blue next to Blue Marble', () => {
    expect(toneReflectance(600, RED)!).toBeGreaterThan(toneReflectance(600, BLUE)!);
    expect(toneReflectance(600, GREEN)!).toBeGreaterThan(toneReflectance(600, BLUE)!);
  });

  it('rolls bright surfaces off instead of clipping them', () => {
    for (const c of [RED, GREEN, BLUE]) {
      const at = (dn: number) => toneReflectance(dn, c) as number;
      expect(at(3000)).toBeLessThan(250);
      expect(at(6000)).toBeGreaterThan(at(3000));
      expect(at(20000)).toBe(255);
      for (let dn = 0; dn < 12000; dn += 50) expect(at(dn + 50)).toBeGreaterThanOrEqual(at(dn));
    }
  });

  it('leaves nodata for Blue Marble to fill', () => {
    expect(toneReflectance(-32768, RED)).toBeNull();
  });
});

describe('which mosaic and month to bake', () => {
  it('uses the same quarter a year back, the latest one published', () => {
    expect(mosaicQuarter(new Date('2026-11-23T00:00:00Z'))).toEqual({ year: 2025, quarter: 4, firstMonth: '10' });
    expect(mosaicQuarter(new Date('2026-02-01T00:00:00Z'))).toEqual({ year: 2025, quarter: 1, firstMonth: '01' });
  });

  it('fills from the Blue Marble month of the bake date', () => {
    expect(bmngMonth(new Date('2026-11-23T00:00:00Z'))).toEqual({ name: 'november', stamp: '200411' });
    expect(bmngMonth(new Date('2026-01-31T23:00:00Z'))).toEqual({ name: 'january', stamp: '200401' });
  });
});

describe('the colour period recorded in meta.json', () => {
  const bake = new Date('2026-11-23T00:00:00Z');

  it('names the Sentinel-2 quarter when the overlay wrote pixels', () => {
    expect(colorPeriod(bake, 12_345)).toEqual({ source: 'sentinel-2', year: 2025, quarter: 4 });
  });

  it('names the Blue Marble month when Sentinel-2 was skipped or wrote nothing', () => {
    expect(colorPeriod(bake, 0)).toEqual({ source: 'blue-marble', year: 2004, month: 11 });
  });
});
