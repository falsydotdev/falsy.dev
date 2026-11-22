export interface FrameTimes {
  p50: number | null;
  p90: number | null;
  samples: number;
}

/** Median and 90th percentile of recent GPU frame times, in ms to one decimal. */
export function frameTimes(log: readonly number[]): FrameTimes {
  if (log.length === 0) return { p50: null, p90: null, samples: 0 };
  const sorted = [...log].sort((a, b) => a - b);
  const at = (q: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] * 10) / 10;
  return { p50: at(0.5), p90: at(0.9), samples: sorted.length };
}
