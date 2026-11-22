import { describe, expect, it } from 'vitest';
import { frameTimes } from '../../src/scene/perf.ts';

describe('frameTimes', () => {
  it('reports nulls without samples, as on WebGL2', () => {
    expect(frameTimes([])).toEqual({ p50: null, p90: null, samples: 0 });
  });

  it('takes the median and 90th percentile regardless of order', () => {
    const log = [9, 1, 5, 3, 7, 2, 10, 4, 8, 6];
    expect(frameTimes(log)).toEqual({ p50: 6, p90: 10, samples: 10 });
  });

  it('rounds to a tenth of a millisecond', () => {
    expect(frameTimes([12.345])).toEqual({ p50: 12.3, p90: 12.3, samples: 1 });
  });
});
