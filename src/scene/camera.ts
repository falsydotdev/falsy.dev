import { type Vec3, vec } from './ephemeris.ts';

/**
 * Orbit camera in the body frame: looks along the ground track, pitched down by the
 * horizon dip plus `tiltDeg`, so the horizon sits in the upper part of the frame.
 */
export function orbitCameraPose(rBody: Vec3, velocityBody: Vec3, radiusKm: number, tiltDeg: number) {
  const up = vec.norm(rBody);
  const v = vec.norm(velocityBody);
  const horiz = vec.norm(vec.sub(v, vec.scale(up, vec.dot(v, up))));
  const down = Math.acos(radiusKm / vec.len(rBody)) + (tiltDeg * Math.PI) / 180;
  const forward = vec.add(vec.scale(horiz, Math.cos(down)), vec.scale(up, -Math.sin(down)));
  return { position: rBody, forward, up };
}
