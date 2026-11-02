import type { CameraSample } from './orbit';

export interface TelemetryOptions {
  body: string;
  relief: number;
}

export function telemetryParts(s: CameraSample, opts: TelemetryOptions) {
  return [
    opts.body.toUpperCase(),
    `${Math.abs(s.lat).toFixed(1)}°${s.lat >= 0 ? 'N' : 'S'}`,
    `${s.lon.toFixed(1)}°E`,
    `LST ${s.lst}`,
    `ALT ${Math.round(s.altKm)} km`,
    `v ${s.speed.toFixed(2)} km/s`,
    `relief×${opts.relief}`,
  ];
}

export const formatTelemetry = (s: CameraSample, opts: TelemetryOptions) => telemetryParts(s, opts).join('  ');
