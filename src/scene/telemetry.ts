import type { CameraSample } from './orbit.ts';

export interface TelemetryOptions {
  body: string;
  relief: number;
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
  if (opts.clouds) parts.push(opts.clouds);
  return parts;
}

export const formatTelemetry = (s: CameraSample, opts: TelemetryOptions) => telemetryParts(s, opts).join('  ');
