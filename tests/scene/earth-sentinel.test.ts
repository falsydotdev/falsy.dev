import { describe, expect, it } from 'vitest';
import { bmngMonth, mosaicQuarter, toneReflectance } from '../../scripts/tiles/earth/sentinel.ts';

describe('Sentinel-2 tone curve', () => {
  it('follows the Copernicus true-colour display mapping (DN / 10000 × 2.5) below the shoulder', () => {
    expect(toneReflectance(0)).toBe(0);
    expect(toneReflectance(1000)).toBe(64);
    expect(toneReflectance(2000)).toBe(128);
  });

  it('rolls bright surfaces off instead of clipping them', () => {
    const at = (dn: number) => toneReflectance(dn) as number;
    expect(at(4000)).toBeLessThan(250);
    expect(at(4000)).toBeGreaterThan(at(3500));
    expect(at(6000)).toBeGreaterThan(at(4000));
    expect(at(10000)).toBe(255);
    for (let dn = 0; dn < 12000; dn += 50) expect(at(dn + 50)).toBeGreaterThanOrEqual(at(dn));
  });

  it('leaves nodata for Blue Marble to fill', () => {
    expect(toneReflectance(-32768)).toBeNull();
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
