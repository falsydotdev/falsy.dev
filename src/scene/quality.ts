// Quality tiers for the live scene, and the governor that steps down through them when a
// machine can't render a tier without running its GPU hot.

export type TierName = 'high' | 'medium' | 'low';

export interface Tier {
  name: TierName;
  /** Upper bound on device pixels per CSS pixel. */
  pixelRatio: number;
  /** Upper bound on rendered pixels, so a 5K display doesn't render 6 MP at High. */
  maxMegapixels: number;
  bloom: boolean;
  /** The camera moves slowly, so 30 looks the same as 60. A divisor of 60 and 120, so the cap lands on whole refreshes. */
  fps: number;
}

// Terrain texels are about a screen pixel at best, so rendering past 1.25× mostly sharpens
// stars; side by side, High at 2× and Low at 1× differed by under 1/255 per pixel.
export const TIERS: readonly Tier[] = [
  { name: 'high', pixelRatio: 1.25, maxMegapixels: 4.2, bloom: true, fps: 30 },
  { name: 'medium', pixelRatio: 1, maxMegapixels: 3.7, bloom: true, fps: 30 },
  { name: 'low', pixelRatio: 0.75, maxMegapixels: 2.1, bloom: false, fps: 20 },
];

export function tier(name: TierName): Tier {
  return TIERS.find((t) => t.name === name) ?? TIERS[1];
}

export function isTierName(s: string | null | undefined): s is TierName {
  return TIERS.some((t) => t.name === s);
}

/** Device pixels per CSS pixel for a tier on this screen. */
export function renderPixelRatio(t: Tier, devicePixelRatio: number, cssWidth: number, cssHeight: number) {
  const cap = Math.sqrt((t.maxMegapixels * 1e6) / Math.max(1, cssWidth * cssHeight));
  return Math.max(0.5, Math.min(devicePixelRatio, t.pixelRatio, cap));
}

export interface GpuHints {
  backend: 'WebGPU' | 'WebGL2';
  /** WebGPU `adapter.info` fields, or the unmasked WebGL renderer string as `description`. */
  vendor?: string;
  architecture?: string;
  description?: string;
}

const SOFTWARE = /swiftshader|llvmpipe|softpipe|lavapipe|basic render|software/i;

/** Where to start before any frame is measured. Measurement then only ever steps down. */
export function initialTier(h: GpuHints): TierName | 'poster' {
  const text = `${h.vendor ?? ''} ${h.architecture ?? ''} ${h.description ?? ''}`;
  if (SOFTWARE.test(text)) return 'poster';
  if (h.backend === 'WebGL2') return 'low';
  if (/apple|nvidia|amd|ati/i.test(h.vendor ?? '')) return 'high';
  return 'medium';
}

export type Verdict = 'hold' | 'down' | 'give-up';

export interface GovernorOptions {
  /** Rendered frames ignored after a start or a tier change, while pipelines compile. */
  warmup?: number;
  /** Samples per judgement; the median of each window is compared to the limit. */
  window?: number;
  /** Over-limit windows in a row that trigger a step down once the scene is showing. */
  patience?: number;
  limit: number;
  /** At the lowest tier, the limit past which the scene stops instead. */
  giveUpLimit: number;
}

/**
 * Takes one load sample per rendered frame and says when to step down a tier. Before the
 * scene is showing it reacts to the first bad window; after that it waits for `patience` bad
 * windows in a row, so one hitch doesn't cost a tier. It never steps back up.
 */
export class Governor {
  tier: TierName;
  readonly opts: Required<GovernorOptions>;
  private samples: number[] = [];
  private skip: number;
  private strikes = 0;
  /** Median of the last full window, for diagnostics. */
  lastMedian = 0;

  constructor(start: TierName, opts: GovernorOptions) {
    this.tier = start;
    this.opts = { warmup: 6, window: 20, patience: 2, ...opts };
    this.skip = this.opts.warmup;
  }

  /** Forget partial measurements, for example after the tab was hidden. */
  reset() {
    this.samples = [];
    this.skip = this.opts.warmup;
  }

  sample(load: number, showing: boolean): Verdict {
    if (this.skip > 0) {
      this.skip--;
      return 'hold';
    }
    this.samples.push(load);
    if (this.samples.length < this.opts.window) return 'hold';
    const sorted = this.samples.sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    this.lastMedian = median;
    this.samples = [];

    const lowest = this.tier === TIERS[TIERS.length - 1].name;
    const limit = lowest ? this.opts.giveUpLimit : this.opts.limit;
    if (median <= limit) {
      this.strikes = 0;
      return 'hold';
    }
    this.strikes++;
    if (showing && this.strikes < this.opts.patience) return 'hold';
    this.strikes = 0;
    this.skip = this.opts.warmup;
    if (lowest) return 'give-up';
    this.tier = TIERS[TIERS.findIndex((t) => t.name === this.tier) + 1].name;
    return 'down';
  }
}
