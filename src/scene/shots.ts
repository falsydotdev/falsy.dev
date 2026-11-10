import { type Vec3, DEG, vec, bodyFrame, fromBody, sunFrom, bodyVector, sunElevationAt } from './ephemeris.ts';
import { type CircularOrbit, circularOrbit } from './orbit.ts';
import { type Body, MARS } from './bodies.ts';
import type { Feature } from './features.ts';

export type ShotKind = 'dawn-dusk' | 'orbital-sunrise' | 'feature-flyover';

export interface Shot {
  kind: ShotKind;
  orbit: CircularOrbit;
  feature?: Feature;
  // When the moment the shot is built around happens: shadow exit, or the pass over the feature.
  keyMoment?: Date;
}

export interface ShotOptions {
  body?: Body;
  altKm?: number;
  rand?: () => number;
}

function resolve(opts: ShotOptions) {
  const body = opts.body ?? MARS;
  return { body, altKm: opts.altKm ?? body.altKm };
}

const FLYOVER_LEAD_S = 180;
const LOW_SUN = { min: 5, max: 25 };
// The text column is on the left, so every shot keeps the bright side of the frame on the right:
// the Sun lights the right-hand terrain, a flyover passes its feature on the right, and the
// sunrise breaks right of centre.
const FLYOVER_OFFSET_KM = 100;
const SUNRISE_RIGHT_DEG = 15;

// Two unit vectors that, with `axis`, make a right-handed orthonormal basis. The
// first lies in the body's equatorial plane, so results don't depend on J2000 quirks.
function perpendicularBasis(axis: Vec3, pole: Vec3): [Vec3, Vec3] {
  let p = vec.cross(axis, pole);
  if (vec.len(p) < 1e-6) p = vec.cross(axis, [1, 0, 0]);
  const u = vec.norm(p);
  return [u, vec.cross(axis, u)];
}

/** The camera's right-hand direction for an orbit camera at `r` moving along `v`. */
export const cameraRight = (r: Vec3, v: Vec3) => vec.norm(vec.cross(v, r));

// An orbit whose plane is perpendicular to the Sun line, so the camera stays over
// the terminator. It isn't a J2-precessing sun-synchronous orbit, but over a visit
// of minutes the two are indistinguishable. It runs so the dayside is on the right.
// A body with `dawnDuskSunDeg` tips the plane toward the Sun and starts where the Sun stands
// that high; it stays within a few percent of that for the first ~20° of orbit.
export function dawnDusk(now: Date, opts: ShotOptions = {}): Shot {
  const { body, altKm } = resolve(opts);
  const rand = opts.rand ?? Math.random;
  const sun = sunFrom(body, now);
  const [u, w] = perpendicularBasis(sun, bodyFrame(body, now).z);
  const tip = body.shots.dawnDuskSunDeg * DEG;
  if (!tip) return { kind: 'dawn-dusk', orbit: circularOrbit(body, now, altKm, u, vec.scale(w, -1), rand() * 2 * Math.PI) };
  const e2 = vec.add(vec.scale(w, -Math.cos(tip)), vec.scale(sun, Math.sin(tip)));
  return { kind: 'dawn-dusk', orbit: circularOrbit(body, now, altKm, u, e2, Math.PI / 2 - 0.15 + rand() * 0.15) };
}

// An orbit tipped a little off the Sun line, starting on the night side shortly before the
// camera leaves the planet's shadow. The tip puts the sunrise right of centre.
export function orbitalSunrise(now: Date, opts: ShotOptions = {}): Shot {
  const { body, altKm } = resolve(opts);
  const rand = opts.rand ?? Math.random;
  const sun = sunFrom(body, now);
  const [p, q] = perpendicularBasis(sun, bodyFrame(body, now).z);
  const phi = rand() * 2 * Math.PI;
  const u = vec.add(vec.scale(p, Math.cos(phi)), vec.scale(q, Math.sin(phi)));
  const tip = SUNRISE_RIGHT_DEG * DEG;
  const e1 = vec.add(vec.scale(sun, Math.cos(tip)), vec.scale(vec.cross(sun, u), Math.sin(tip)));
  const probe = circularOrbit(body, now, altKm, e1, u, 0);
  // r = a (cos θ e1 + sin θ u) has a·cos θ·cos(tip) along the Sun line, so it's in the
  // cylindrical shadow while cos θ < −c, with c = √(1 − R²/a²) / cos(tip).
  const c = Math.sqrt(1 - ((body.radiusKm + body.shots.sunriseLimbKm) / probe.a) ** 2) / Math.cos(tip);
  const exit = Math.PI + Math.acos(c);
  const lead = body.shots.sunriseLeadS;
  const orbit = { ...probe, theta0: exit - probe.n * lead };
  return { kind: 'orbital-sunrise', orbit, keyMoment: new Date(now.getTime() + lead * 1000) };
}

export function lowSunFeatures(body: Body, when: Date, features: Feature[] = body.features) {
  return features.filter((f) => {
    const elevation = sunElevationAt(body, when, f.lat, f.lon);
    const { min, max } = f.sun ?? LOW_SUN;
    return elevation >= min && elevation <= max;
  });
}

// An orbit whose ground track passes a low-Sun feature a few minutes after load, with the
// feature off to the right. It travels along the local terminator so the Sun stays to the
// right too. `anySun` drops the low-Sun filter, for previewing one feature at any time of day.
export function featureFlyover(now: Date, opts: ShotOptions & { features?: Feature[]; anySun?: boolean } = {}): Shot | null {
  const { body, altKm } = resolve(opts);
  const rand = opts.rand ?? Math.random;
  const pass = new Date(now.getTime() + FLYOVER_LEAD_S * 1000);
  const candidates = opts.anySun ? (opts.features ?? body.features) : lowSunFeatures(body, pass, opts.features);
  if (candidates.length === 0) return null;
  const feature = candidates[Math.floor(rand() * candidates.length)];
  const f = fromBody(bodyFrame(body, pass), bodyVector(feature.lat, feature.lon));
  const along = vec.norm(vec.cross(f, sunFrom(body, pass)));
  const offset = FLYOVER_OFFSET_KM / body.radiusKm;
  const track = vec.sub(vec.scale(f, Math.cos(offset)), vec.scale(cameraRight(f, along), Math.sin(offset)));
  const probe = circularOrbit(body, now, altKm, track, along, 0);
  const orbit = { ...probe, theta0: -probe.n * FLYOVER_LEAD_S };
  return { kind: 'feature-flyover', orbit, feature, keyMoment: pass };
}

/** A repeatable stand-in for Math.random (mulberry32). */
export function seededRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A shot runs at least this long past its key moment. A sunrise opens with the ground below
// still in shadow while the Sun climbs ahead, and has to play out.
const RESHOOT_AFTER_S = 600;

/** Whether the orbit has carried the camera, long after its shot's moment, over ground too dark to see. */
export function wantsReshoot(shot: Shot, builtAt: Date, s: { date: Date; rBody: Vec3; sunBody: Vec3 }) {
  if (s.date.getTime() < (shot.keyMoment ?? builtAt).getTime() + RESHOOT_AFTER_S * 1000) return false;
  return Math.asin(vec.dot(vec.norm(s.rBody), s.sunBody)) / DEG < shot.orbit.body.shots.darkBelowDeg;
}

export function chooseShot(now: Date, opts: ShotOptions & { features?: Feature[] } = {}): Shot {
  const rand = opts.rand ?? Math.random;
  const weights = Object.entries(resolve(opts).body.shots.weights) as [ShotKind, number][];
  let roll = rand();
  const kind = weights.find(([, w]) => (roll -= w) < 0)?.[0] ?? 'dawn-dusk';
  if (kind === 'orbital-sunrise') return orbitalSunrise(now, opts);
  if (kind === 'feature-flyover') return featureFlyover(now, opts) ?? dawnDusk(now, opts);
  return dawnDusk(now, opts);
}
