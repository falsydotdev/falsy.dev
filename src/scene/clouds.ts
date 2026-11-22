// Earth's cloud layer, the parts that don't need a GPU: where a point falls in the cloud texture,
// whether the view is over a polar cap without data, and what the readout says about it.
import { latLon, vec, type Vec3 } from './ephemeris.ts';

/** The cloud texture's size: one single-channel map, within WebGPU's default 8192 px texture limit. */
export const CLOUD_TEXTURE = { width: 4096, height: 2048 } as const;

/** Longitude is east-positive in any range; the map's row 0 is 90°N and column 0 is 180°W. */
export function cloudUv(latDeg: number, lonDeg: number): [number, number] {
  const u = (((lonDeg + 180) % 360) + 360) % 360 / 360;
  return [u, (90 - latDeg) / 180];
}

/** The latitudes past which the cloud source has no data, from the cloud set's metadata. */
export interface CloudPolar {
  north: number;
  south: number;
}

// Judged under the view's centre, or at the horizon ahead when the centre is sky, since the camera looks well ahead.
export function overCloudCap(pose: { position: Vec3; forward: Vec3 }, radiusKm: number, polar: CloudPolar): boolean {
  const { lat } = latLon(viewGround(pose, radiusKm));
  return lat > polar.north || lat < polar.south;
}

function viewGround({ position: p, forward: f }: { position: Vec3; forward: Vec3 }, R: number): Vec3 {
  const b = vec.dot(p, f);
  const disc = b * b - (vec.dot(p, p) - R * R);
  if (disc >= 0 && -b - Math.sqrt(disc) > 0) return vec.add(p, vec.scale(f, -b - Math.sqrt(disc)));
  const up = vec.norm(p);
  const ahead = vec.norm(vec.sub(f, vec.scale(up, vec.dot(f, up))));
  const dip = Math.acos(Math.min(1, R / vec.len(p)));
  return vec.add(vec.scale(up, Math.cos(dip)), vec.scale(ahead, Math.sin(dip)));
}

export type CloudStatus = 'loading' | 'ready' | 'failed';

/** Which cloud set is drawn: the cloud job's output, or the static map shipped with the site. */
export interface CloudSetInfo {
  source: 'live' | 'static';
  valid: Date;
}

export interface CloudReadoutInput {
  status: CloudStatus;
  /** The set on screen, once one has loaded. */
  set: CloudSetInfo | null;
  now: Date;
  overCap: boolean;
}

/** Past this age a live set is stale: the job runs every 3 hours, so at least one run has failed. */
export const CLOUDS_STALE_MS = 6 * 3_600_000;

/** Whether a live set is stale at `now`. Judged from its valid time, since a pointer's own flag freezes when the job stops. */
export const cloudsStale = (valid: Date, now: Date) => now.getTime() - valid.getTime() > CLOUDS_STALE_MS;

export interface CloudCandidate {
  /** A set's metadata: the latest pointer, a dated set's meta.json, or the static map's pointer. */
  url: string;
  source: CloudSetInfo['source'];
}

const HOUR_MS = 3_600_000;
// The cloud job's object key for a valid time, e.g. 20261122T0900Z (clouds/worker/job.js).
const stampOf = (d: Date) => d.toISOString().slice(0, 16).replace(/[-:]/g, '') + 'Z';

// A pinned moment takes the newest set valid in the 6 hours up to it, the job's rule for poster sets.
// The bucket can't be listed, so this probes each hour, since sets are valid on the hour.
export function cloudCandidates({ base, staticUrl, at }: { base: string | null; staticUrl: string; at?: Date }): CloudCandidate[] {
  const fallback: CloudCandidate = { url: staticUrl, source: 'static' };
  if (!base) return [fallback];
  if (!at) return [{ url: `${base}/latest.json`, source: 'live' }, fallback];
  const sets: CloudCandidate[] = [];
  for (let t = Math.floor(at.getTime() / HOUR_MS) * HOUR_MS; t > at.getTime() - CLOUDS_STALE_MS; t -= HOUR_MS) {
    for (const prefix of ['dated', 'kept']) sets.push({ url: `${base}/${prefix}/${stampOf(new Date(t))}/meta.json`, source: 'live' });
  }
  return [...sets, fallback];
}

/** Whether the latest pointer's valid time names a set worth loading over the one on screen. */
export function cloudsNewer(current: CloudSetInfo | null, pointerValid: string | null): boolean {
  const valid = pointerValid === null ? NaN : Date.parse(pointerValid);
  if (Number.isNaN(valid)) return false;
  return current?.source !== 'live' || valid > current.valid.getTime();
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const pad = (n: number) => String(n).padStart(2, '0');
const validLabel = (d: Date) => `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`;

/** The readout's cloud item, or null while there's nothing to say. */
export function cloudReadout({ status, set, now, overCap }: CloudReadoutInput): string | null {
  if (status === 'loading') return null;
  if (status === 'failed' || !set) return 'clouds: unavailable';
  if (overCap) return 'clouds: no polar data';
  if (set.source === 'static') return 'clouds: static map, detail synthesised';
  return `clouds ${validLabel(set.valid)}${cloudsStale(set.valid, now) ? ', stale' : ''}, detail synthesised`;
}
