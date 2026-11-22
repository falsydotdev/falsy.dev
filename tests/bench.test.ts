import { describe, expect, it } from 'vitest';
import { benchView, runOrder, summarise } from '../scripts/posters/bench-plan.mjs';

describe('runOrder', () => {
  it('runs every toggle once a round, mirroring each round so drift cancels', () => {
    expect(runOrder(['', 'shadows', 'bloom'], 4)).toEqual(['', 'shadows', 'bloom', 'bloom', 'shadows', '', '', 'shadows', 'bloom', 'bloom', 'shadows', '']);
  });
});

describe('benchView', () => {
  const viewport = { width: 1440, height: 900 };

  it("raises the browser's pixel ratio to a requested scale, which the scene never renders above", () => {
    expect(benchView({ viewport, dpr: 1, scale: 2, tier: 'high' })).toEqual({ deviceScaleFactor: 2, pixelRatio: 2, width: 2880, height: 1800 });
  });

  it("keeps a higher screen ratio when the scale is below it", () => {
    expect(benchView({ viewport, dpr: 2, scale: 1.5, tier: 'high' })).toMatchObject({ deviceScaleFactor: 2, pixelRatio: 1.5 });
  });

  it("renders at the tier's own cap without a scale, as a visitor's screen would", () => {
    expect(benchView({ viewport, dpr: 2, tier: 'high' })).toEqual({ deviceScaleFactor: 2, pixelRatio: 1.25, width: 1800, height: 1125 });
    expect(benchView({ viewport, dpr: 2, tier: 'low' })).toMatchObject({ pixelRatio: 0.75, width: 1080 });
  });
});

describe('summarise', () => {
  const runs = [
    { fx: '', samples: [10, 10, 10, 10, 12] },
    { fx: 'shadows', samples: [7, 7, 7, 8, 7] },
    { fx: 'shadows', samples: [9, 9, 9, 9, 9] },
    { fx: '', samples: [10, 11, 10, 10, 10] },
  ];

  it('pools every run of a toggle into one p10, median, and p90, with the spread across runs', () => {
    expect(summarise(runs)[0]).toEqual({ fx: '', runs: 2, samples: 10, p10: 10, p50: 10, p90: 11, runP10: [10, 10], runP50: [10, 10], deltaP10: 0, deltaP50: 0, deltaP90: 0 });
  });

  it('gives each toggle its difference from the first, all-layers-on toggle', () => {
    expect(summarise(runs)[1]).toEqual({ fx: 'shadows', runs: 2, samples: 10, p10: 7, p50: 8, p90: 9, runP10: [7, 9], runP50: [7, 9], deltaP10: -3, deltaP50: -2, deltaP90: -2 });
  });
});
