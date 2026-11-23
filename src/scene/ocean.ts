import { type Vec3, vec } from './ephemeris.ts';

// Sea-surface optics for bodies with an ocean. The terrain shader (live/ocean.js) uses the same
// formulas; these are the testable statement of them.

/** Mean square slope of a clean sea at wind speed `windMs` (m/s at 12.5 m): Cox and Munk (1954). */
export const slopeVariance = (windMs: number) => 0.003 + 5.12e-3 * windMs;

/** Reflectance of water at normal incidence, from its refractive index of 1.333. */
export const WATER_F0 = ((1.333 - 1) / (1.333 + 1)) ** 2;

/** Share of light the sea reflects at incidence cosine `cosTheta` (Schlick's approximation). */
export const fresnel = (cosTheta: number) => WATER_F0 + (1 - WATER_F0) * (1 - Math.min(Math.max(cosTheta, 0), 1)) ** 5;

const angle = (a: Vec3, b: Vec3) => Math.acos(Math.min(1, Math.max(-1, vec.dot(a, b))));

/**
 * Unit direction from the centre to where a smooth sphere mirrors the Sun (unit vector `sun`) into a
 * camera at `camera` (km from the centre), or null when that point is unlit or out of sight.
 */
export function specularPoint(camera: Vec3, sun: Vec3, radiusKm: number): Vec3 | null {
  const c = vec.norm(camera);
  const toward = vec.sub(sun, vec.scale(c, vec.dot(sun, c)));
  if (vec.len(toward) < 1e-12) return vec.dot(sun, c) > 0 ? c : null;
  const t = vec.norm(toward);
  const at = (phi: number): Vec3 => vec.add(vec.scale(c, Math.cos(phi)), vec.scale(t, Math.sin(phi)));
  const view = (p: Vec3) => vec.norm(vec.sub(camera, vec.scale(p, radiusKm)));
  // Along the great circle from below the camera toward the Sun, the Sun's angle from the normal
  // falls from its full value to 0 while the camera's rises from 0, so they cross once.
  let lo = 0;
  let hi = angle(c, sun);
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const p = at(mid);
    if (angle(p, sun) > angle(p, view(p))) lo = mid;
    else hi = mid;
  }
  const p = at((lo + hi) / 2);
  return vec.dot(p, sun) > 0 && vec.dot(p, view(p)) > 0 ? p : null;
}
