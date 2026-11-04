import * as A from 'astronomy-engine';

export type Vec3 = readonly [number, number, number];

export const DEG = Math.PI / 180;

export const vec = {
  dot: (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  scale: (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s],
  add: (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  len: (a: Vec3) => Math.hypot(a[0], a[1], a[2]),
  norm: (a: Vec3): Vec3 => vec.scale(a, 1 / vec.len(a)),
};

export interface BodyFrame {
  x: Vec3;
  y: Vec3;
  z: Vec3;
}

// Mars body-fixed axes in J2000 equatorial coordinates (IAU 2015 model). The
// prime meridian sits at angle W from the ascending node of Mars' equator, which
// is at RA α0 + 90°.
export function marsFrame(date: Date): BodyFrame {
  const axis = A.RotationAxis(A.Body.Mars, date);
  const z: Vec3 = [axis.north.x, axis.north.y, axis.north.z];
  const a0 = axis.ra * 15 * DEG;
  const node: Vec3 = [-Math.sin(a0), Math.cos(a0), 0];
  const w = axis.spin * DEG;
  const x = vec.add(vec.scale(node, Math.cos(w)), vec.scale(vec.cross(z, node), Math.sin(w)));
  return { x, y: vec.cross(z, x), z };
}

export const toBody = (f: BodyFrame, v: Vec3): Vec3 => [vec.dot(v, f.x), vec.dot(v, f.y), vec.dot(v, f.z)];

export const fromBody = (f: BodyFrame, v: Vec3): Vec3 =>
  vec.add(vec.add(vec.scale(f.x, v[0]), vec.scale(f.y, v[1])), vec.scale(f.z, v[2]));

// Unit vector from Mars to the Sun, J2000 equatorial.
export function sunJ2000(date: Date): Vec3 {
  const h = A.HelioVector(A.Body.Mars, date);
  return vec.norm([-h.x, -h.y, -h.z]);
}

export function latLon(v: Vec3) {
  const n = vec.norm(v);
  return { lat: Math.asin(n[2]) / DEG, lon: (((Math.atan2(n[1], n[0]) / DEG) % 360) + 360) % 360 };
}

export function marsState(date: Date) {
  const helio = A.HelioVector(A.Body.Mars, date);
  const frame = marsFrame(date);
  const sun = toBody(frame, sunJ2000(date));
  const sub = latLon(sun);
  return { frame, sun, distanceAu: Math.hypot(helio.x, helio.y, helio.z), subSolarLat: sub.lat, subSolarLon: sub.lon };
}

export function bodyVector(latDeg: number, lonDeg: number): Vec3 {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}

export function sunElevationAt(date: Date, latDeg: number, lonDeg: number) {
  return Math.asin(vec.dot(marsState(date).sun, bodyVector(latDeg, lonDeg))) / DEG;
}

// Next time after `from` when the Sun climbs through `elevation` degrees at a site,
// or null if that doesn't happen within two sols.
export function nextSunrise(from: Date, latDeg: number, lonDeg: number, elevation = 6): Date | null {
  const stepMs = 5 * 60 * 1000;
  let t = from.getTime();
  let prev = sunElevationAt(new Date(t), latDeg, lonDeg);
  for (let i = 0; i < 2 * 25 * 12; i++) {
    const next = sunElevationAt(new Date(t + stepMs), latDeg, lonDeg);
    if (prev < elevation && next >= elevation) return new Date(t + ((elevation - prev) / (next - prev)) * stepMs);
    prev = next;
    t += stepMs;
  }
  return null;
}

// Local true solar time on Mars, in Mars hours (a sol divided into 24).
export function localSolarTime(lonDeg: number, subSolarLon: number) {
  const h = ((((lonDeg - subSolarLon) / 15 + 12) % 24) + 24) % 24;
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
