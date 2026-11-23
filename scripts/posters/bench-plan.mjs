// The parts of the frame-time benchmark that don't need a browser.
import { renderPixelRatio, tier as tierByName } from '../../src/scene/quality.ts';

/**
 * The order to run each `fx=` value in. Every other round runs backwards, so a GPU that warms
 * up or throttles over the session weighs on every toggle alike.
 * @param {string[]} toggles
 * @param {number} rounds
 */
export function runOrder(toggles, rounds) {
  return Array.from({ length: rounds }, (_, i) => (i % 2 ? [...toggles].reverse() : toggles)).flat();
}

/**
 * The browser's pixel ratio for a run, and the canvas the scene should then render. The scene
 * caps `scale=` at the screen's own ratio, so a scale above it would quietly render lower.
 * @param {{ viewport: { width: number, height: number }, dpr: number, scale?: number, tier: import('../../src/scene/quality.ts').TierName }} o
 */
export function benchView({ viewport, dpr, scale, tier }) {
  const deviceScaleFactor = scale ? Math.max(dpr, scale) : dpr;
  const pixelRatio = scale ?? renderPixelRatio(tierByName(tier), deviceScaleFactor, viewport.width, viewport.height);
  return { deviceScaleFactor, pixelRatio, width: Math.floor(viewport.width * pixelRatio), height: Math.floor(viewport.height * pixelRatio) };
}

const round = (ms) => Math.round(ms * 100) / 100;
// Nearest rank, as perf.ts takes the median and p90 the field reports.
const percentile = (log, q) => {
  const sorted = [...log].sort((a, b) => a - b);
  return round(sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)]);
};
const spread = (runs, q) => {
  const each = runs.map((r) => percentile(r.samples, q));
  return [Math.min(...each), Math.max(...each)];
};

/**
 * GPU frame time per `fx=` value, pooled over its runs, against the first value (all layers on).
 * Median and p90 match the field numbers; p10 shows the floor. `runP10` and `runP50` give the
 * lowest and highest per-run value, a read of the noise.
 * @param {{ fx: string, samples: number[] }[]} runs
 */
export function summarise(runs) {
  const toggles = [...new Set(runs.map((r) => r.fx))];
  const rows = toggles.map((fx) => {
    const mine = runs.filter((r) => r.fx === fx);
    const all = mine.flatMap((r) => r.samples);
    return {
      fx,
      runs: mine.length,
      samples: all.length,
      p10: percentile(all, 0.1),
      p50: percentile(all, 0.5),
      p90: percentile(all, 0.9),
      runP10: spread(mine, 0.1),
      runP50: spread(mine, 0.5),
    };
  });
  const [base] = rows;
  const delta = (a, b) => round(a - b);
  return rows.map((r) => ({ ...r, deltaP10: delta(r.p10, base.p10), deltaP50: delta(r.p50, base.p50), deltaP90: delta(r.p90, base.p90) }));
}
