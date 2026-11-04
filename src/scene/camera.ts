import { type Vec3, vec } from './ephemeris.ts';

export interface CameraPose {
  position: Vec3;
  forward: Vec3;
  up: Vec3;
}

/**
 * Orbit camera in the body frame: looks along the ground track, pitched down by the
 * horizon dip plus `tiltDeg`. A positive `rollDeg` banks right, so the horizon drops on
 * the left of the frame and rises on the right.
 */
export function orbitCameraPose(rBody: Vec3, velocityBody: Vec3, radiusKm: number, tiltDeg: number, rollDeg = 0): CameraPose {
  const radial = vec.norm(rBody);
  const v = vec.norm(velocityBody);
  const horiz = vec.norm(vec.sub(v, vec.scale(radial, vec.dot(v, radial))));
  const down = Math.acos(radiusKm / vec.len(rBody)) + (tiltDeg * Math.PI) / 180;
  const forward = vec.add(vec.scale(horiz, Math.cos(down)), vec.scale(radial, -Math.sin(down)));
  const level = vec.add(vec.scale(radial, Math.cos(down)), vec.scale(horiz, Math.sin(down)));
  const right = vec.cross(forward, level);
  const roll = (rollDeg * Math.PI) / 180;
  const up = vec.add(vec.scale(level, Math.cos(roll)), vec.scale(right, Math.sin(roll)));
  return { position: rBody, forward, up };
}

/** Normalised device coordinates (x right, y up, both −1 to 1 on screen), or null behind the camera. */
export function project(point: Vec3, pose: CameraPose, fovYRad: number, aspect: number): [number, number] | null {
  const d = vec.sub(point, pose.position);
  const z = vec.dot(d, pose.forward);
  if (z <= 1e-9) return null;
  const right = vec.cross(pose.forward, pose.up);
  const t = Math.tan(fovYRad / 2);
  return [vec.dot(d, right) / z / (t * aspect), vec.dot(d, pose.up) / z / t];
}
