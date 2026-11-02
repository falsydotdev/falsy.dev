import { type Vec3, vec, marsFrame, toBody, sunJ2000, latLon, localSolarTime } from './ephemeris';

export interface Body {
  name: string;
  gm: number; // km³/s²
  radiusKm: number;
}

// GM from JPL DE440. Radius is the MOLA reference sphere the terrain uses.
export const MARS: Body = { name: 'Mars', gm: 42828.37, radiusKm: 3396.19 };

// A circular two-body orbit in J2000 equatorial coordinates:
// r(t) = a (cos θ e1 + sin θ e2), with θ = θ0 + n (t − epoch).
export interface CircularOrbit {
  body: Body;
  epoch: Date;
  a: number;
  e1: Vec3;
  e2: Vec3;
  theta0: number;
  n: number; // mean motion, rad/s
}

export function circularOrbit(body: Body, epoch: Date, altKm: number, e1: Vec3, e2: Vec3, theta0: number): CircularOrbit {
  const a = body.radiusKm + altKm;
  const u1 = vec.norm(e1);
  const u2 = vec.norm(vec.sub(e2, vec.scale(u1, vec.dot(e2, u1))));
  return { body, epoch, a, e1: u1, e2: u2, theta0, n: Math.sqrt(body.gm / a ** 3) };
}

export const orbitalSpeed = (o: CircularOrbit) => o.n * o.a;
export const orbitalPeriod = (o: CircularOrbit) => (2 * Math.PI) / o.n;

export function thetaAt(o: CircularOrbit, date: Date) {
  return o.theta0 + o.n * ((date.getTime() - o.epoch.getTime()) / 1000);
}

export function stateAt(o: CircularOrbit, date: Date): { r: Vec3; v: Vec3 } {
  const th = thetaAt(o, date);
  const c = Math.cos(th);
  const s = Math.sin(th);
  const r = vec.add(vec.scale(o.e1, o.a * c), vec.scale(o.e2, o.a * s));
  const speed = orbitalSpeed(o);
  const v = vec.add(vec.scale(o.e1, -speed * s), vec.scale(o.e2, speed * c));
  return { r, v };
}

// Inside the planet's cylindrical shadow. The real umbra tapers, but at a few
// hundred km the difference is under a second of orbit.
export function inShadow(r: Vec3, sun: Vec3, radiusKm: number) {
  const along = vec.dot(r, sun);
  return along < 0 && vec.len(vec.sub(r, vec.scale(sun, along))) < radiusKm;
}

export interface CameraSample {
  date: Date;
  r: Vec3; // J2000, km
  v: Vec3; // J2000, km/s
  rBody: Vec3; // body-fixed, km
  sunBody: Vec3; // body-fixed unit vector
  lat: number;
  lon: number;
  altKm: number;
  speed: number; // inertial, km/s
  lst: string;
  shadow: boolean;
}

export function sample(o: CircularOrbit, date: Date): CameraSample {
  const { r, v } = stateAt(o, date);
  const frame = marsFrame(date);
  const sun = sunJ2000(date);
  const rBody = toBody(frame, r);
  const sunBody = toBody(frame, sun);
  const ground = latLon(rBody);
  const subSolar = latLon(sunBody);
  return {
    date,
    r,
    v,
    rBody,
    sunBody,
    lat: ground.lat,
    lon: ground.lon,
    altKm: vec.len(r) - o.body.radiusKm,
    speed: vec.len(v),
    lst: localSolarTime(ground.lon, subSolar.lon),
    shadow: inShadow(r, sun, o.body.radiusKm),
  };
}
