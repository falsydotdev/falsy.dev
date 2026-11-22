// Earth's cloud layer, the parts that don't need a GPU: where a point falls in the cloud texture,
// whether the view is over a polar cap without data, and what the readout says about it.
import { latLon, vec, type Vec3 } from './ephemeris.ts';

/** The cloud texture's size: one single-channel map, within WebGPU's default 8192 px texture limit. */
export const CLOUD_TEXTURE = { width: 4096, height: 2048 } as const;

/**
 * Texture coordinates of a latitude and longitude (degrees, longitude east-positive in any range)
 * in the cloud map, whose row 0 is 90°N and column 0 is 180°W.
 */
export function cloudUv(latDeg: number, lonDeg: number): [number, number] {
  const u = (((lonDeg + 180) % 360) + 360) % 360 / 360;
  return [u, (90 - latDeg) / 180];
}

/** The latitudes past which the cloud source has no data, from the cloud set's metadata. */
export interface CloudPolar {
  north: number;
  south: number;
}

/**
 * Whether the view looks at a polar cap the clouds don't cover. Judged at the ground under the
 * view's centre, or at the horizon ahead when the centre is sky, since the camera looks well ahead.
 */
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

export interface CloudReadoutInput {
  /** Where the cloud set comes from; only the static map so far. */
  source: 'static';
  status: CloudStatus;
  overCap: boolean;
}

/** The readout's cloud item, or null while there's nothing to say. */
export function cloudReadout({ status, overCap }: CloudReadoutInput): string | null {
  if (status === 'loading') return null;
  if (status === 'failed') return 'clouds: unavailable';
  if (overCap) return 'clouds: no polar data';
  return 'clouds: static map, detail synthesised';
}
