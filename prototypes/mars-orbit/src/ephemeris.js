import * as A from 'astronomy-engine';

const DEG = Math.PI / 180;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a, s) => a.map((v) => v * s);
const add = (a, b) => a.map((v, i) => v + b[i]);
const norm = (a) => scale(a, 1 / Math.hypot(...a));

// Mars body-fixed axes expressed in J2000 equatorial coordinates (IAU 2015 model).
// The prime meridian sits at angle W from the ascending node of Mars' equator, at RA = α0 + 90°.
export function marsFrame(date) {
  const axis = A.RotationAxis(A.Body.Mars, date);
  const z = [axis.north.x, axis.north.y, axis.north.z];
  const a0 = axis.ra * 15 * DEG;
  const node = [-Math.sin(a0), Math.cos(a0), 0];
  const w = axis.spin * DEG;
  const x = add(scale(node, Math.cos(w)), scale(cross(z, node), Math.sin(w)));
  const y = cross(z, x);
  return { x, y, z };
}

export function toBody(frame, v) {
  return [dot(v, frame.x), dot(v, frame.y), dot(v, frame.z)];
}

export function marsState(date) {
  const helio = A.HelioVector(A.Body.Mars, date);
  const sunJ2000 = norm([-helio.x, -helio.y, -helio.z]);
  const frame = marsFrame(date);
  const sun = toBody(frame, sunJ2000);
  return {
    frame,
    sun,
    distanceAu: Math.hypot(helio.x, helio.y, helio.z),
    subSolarLat: Math.asin(sun[2]) / DEG,
    subSolarLon: (((Math.atan2(sun[1], sun[0]) / DEG) % 360) + 360) % 360,
  };
}

export function bodyVector(latDeg, lonDeg) {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}

export function sunElevationAt(date, latDeg, lonDeg) {
  const { sun } = marsState(date);
  return Math.asin(dot(sun, bodyVector(latDeg, lonDeg))) / DEG;
}

// Next time after `from` when the Sun climbs through `elevation` degrees at the given site.
export function nextSunrise(from, latDeg, lonDeg, elevation = 6) {
  const stepMs = 5 * 60 * 1000;
  let t = from.getTime();
  let prev = sunElevationAt(new Date(t), latDeg, lonDeg);
  for (let i = 0; i < 2 * 24 * 12 * 2; i++) {
    const next = sunElevationAt(new Date(t + stepMs), latDeg, lonDeg);
    if (prev < elevation && next >= elevation) {
      const f = (elevation - prev) / (next - prev);
      return new Date(t + f * stepMs);
    }
    prev = next;
    t += stepMs;
  }
  return from;
}

export function localSolarTime(lonDeg, subSolarLon) {
  const h = ((((lonDeg - subSolarLon) / 15 + 12) % 24) + 24) % 24;
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export const vec = { dot, cross, scale, add, norm };
