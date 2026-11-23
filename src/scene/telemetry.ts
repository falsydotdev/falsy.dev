import type { CameraSample } from './orbit.ts';

/** Which imagery the colour tiles come from, as the Earth bake records it in meta.json. */
export type ColorPeriod = { source: 'sentinel-2'; year: number; quarter: number } | { source: 'blue-marble'; year: number; month: number };

export interface TelemetryOptions {
  body: string;
  relief: number;
  /** The surface imagery's period, for tiles whose bake recorded one. */
  surface?: string | null;
  /** The cloud layer's readout item, for a body with clouds. */
  clouds?: string | null;
}

export function telemetryParts(s: CameraSample, opts: TelemetryOptions) {
  const parts = [
    opts.body.toUpperCase(),
    `${Math.abs(s.lat).toFixed(1)}°${s.lat >= 0 ? 'N' : 'S'}`,
    `${s.lon.toFixed(1)}°E`,
    `LST ${s.lst}`,
    `ALT ${Math.round(s.altKm)} km`,
    `v ${s.speed.toFixed(2)} km/s`,
    `relief×${opts.relief}`,
  ];
  if (opts.surface) parts.push(opts.surface);
  if (opts.clouds) parts.push(opts.clouds);
  return parts;
}

export const formatTelemetry = (s: CameraSample, opts: TelemetryOptions) => telemetryParts(s, opts).join('  ');

export function surfaceReadout(period: ColorPeriod | undefined): string | null {
  if (!period) return null;
  return period.source === 'sentinel-2' ? `surface ${period.year} Q${period.quarter}` : `surface ${period.year} (Blue Marble)`;
}
