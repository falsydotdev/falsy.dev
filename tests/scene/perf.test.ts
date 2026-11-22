import { describe, expect, it } from 'vitest';
import { frameTimes } from '../../src/scene/perf.ts';

describe('frameTimes', () => {
  it('reports nulls without samples, as on WebGL2', () => {
    expect(frameTimes([])).toEqual({ p50: null, p90: null, samples: 0 });
  });

  it('takes the median and 90th percentile regardless of order', () => {
    const log = [9, 1, 5, 3, 7, 2, 10, 4, 8, 6];
    expect(frameTimes(log)).toEqual({ p50: 5, p90: 9, samples: 10 });
  });

  it("doesn't let one spike in a short window set p90", () => {
    const log = [...Array(19).fill(10), 40];
    expect(frameTimes(log).p90).toBe(10);
  });

  it('rounds to a tenth of a millisecond', () => {
    expect(frameTimes([12.345])).toEqual({ p50: 12.3, p90: 12.3, samples: 1 });
  });
});
