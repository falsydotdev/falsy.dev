import { type Vec3, vec, marsFrame, fromBody, sunJ2000, bodyVector, sunElevationAt } from './ephemeris.ts';
import { type Body, type CircularOrbit, MARS, circularOrbit } from './orbit.ts';
import { type Feature, MARS_FEATURES } from './features.ts';

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

const DEFAULTS = { body: MARS, altKm: 200 };
const SUNRISE_LEAD_S = 60;
const FLYOVER_LEAD_S = 180;
const LOW_SUN = { min: 5, max: 25 };

// Two unit vectors that, with `axis`, make a right-handed orthonormal basis. The
// first lies in the body's equatorial plane, so results don't depend on J2000 quirks.
function perpendicularBasis(axis: Vec3, pole: Vec3): [Vec3, Vec3] {
  let p = vec.cross(axis, pole);
  if (vec.len(p) < 1e-6) p = vec.cross(axis, [1, 0, 0]);
  const u = vec.norm(p);
  return [u, vec.cross(axis, u)];
}

// An orbit whose plane is perpendicular to the Sun line, so the camera stays over
// the terminator. It isn't a J2-precessing sun-synchronous orbit, but over a visit
// of minutes the two are indistinguishable.
export function dawnDusk(now: Date, opts: ShotOptions = {}): Shot {
  const { body, altKm } = { ...DEFAULTS, ...opts };
  const rand = opts.rand ?? Math.random;
  const sun = sunJ2000(now);
  const [u, w] = perpendicularBasis(sun, marsFrame(now).z);
  const e2 = rand() < 0.5 ? w : vec.scale(w, -1);
  return { kind: 'dawn-dusk', orbit: circularOrbit(body, now, altKm, u, e2, rand() * 2 * Math.PI) };
}

// An orbit with the Sun line in its plane, starting on the night side shortly
// before the camera leaves the planet's shadow.
export function orbitalSunrise(now: Date, opts: ShotOptions = {}): Shot {
  const { body, altKm } = { ...DEFAULTS, ...opts };
  const rand = opts.rand ?? Math.random;
  const sun = sunJ2000(now);
  const [p, q] = perpendicularBasis(sun, marsFrame(now).z);
  const phi = rand() * 2 * Math.PI;
  const u = vec.add(vec.scale(p, Math.cos(phi)), vec.scale(q, Math.sin(phi)));
  const probe = circularOrbit(body, now, altKm, sun, u, 0);
  // r = a (cos θ s + sin θ u) is in shadow for θ in (π − β, π + β), sin β = R / a.
  const exit = Math.PI + Math.asin(body.radiusKm / probe.a);
  const orbit = { ...probe, theta0: exit - probe.n * SUNRISE_LEAD_S };
  return { kind: 'orbital-sunrise', orbit, keyMoment: new Date(now.getTime() + SUNRISE_LEAD_S * 1000) };
}

export function lowSunFeatures(when: Date, features: Feature[] = MARS_FEATURES) {
  return features.filter((f) => {
    const elevation = sunElevationAt(when, f.lat, f.lon);
    return elevation >= LOW_SUN.min && elevation <= LOW_SUN.max;
  });
}

// An orbit whose ground track crosses a low-Sun feature a few minutes after load,
// travelling along the local terminator so the Sun stays off to the side. `anySun` drops
// the low-Sun filter, for previewing one feature whatever its time of day.
export function featureFlyover(now: Date, opts: ShotOptions & { features?: Feature[]; anySun?: boolean } = {}): Shot | null {
  const { body, altKm } = { ...DEFAULTS, ...opts };
  const rand = opts.rand ?? Math.random;
  const pass = new Date(now.getTime() + FLYOVER_LEAD_S * 1000);
  const candidates = opts.anySun ? (opts.features ?? MARS_FEATURES) : lowSunFeatures(pass, opts.features);
  if (candidates.length === 0) return null;
  const feature = candidates[Math.floor(rand() * candidates.length)];
  const f = fromBody(marsFrame(pass), bodyVector(feature.lat, feature.lon));
  let along = vec.norm(vec.cross(sunJ2000(pass), f));
  if (rand() < 0.5) along = vec.scale(along, -1);
  const probe = circularOrbit(body, now, altKm, f, along, 0);
  const orbit = { ...probe, theta0: -probe.n * FLYOVER_LEAD_S };
  return { kind: 'feature-flyover', orbit, feature, keyMoment: pass };
}

const WEIGHTS: [ShotKind, number][] = [
  ['dawn-dusk', 0.4],
  ['orbital-sunrise', 0.3],
  ['feature-flyover', 0.3],
];

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

export function chooseShot(now: Date, opts: ShotOptions & { features?: Feature[] } = {}): Shot {
  const rand = opts.rand ?? Math.random;
  let roll = rand();
  const kind = WEIGHTS.find(([, w]) => (roll -= w) < 0)?.[0] ?? 'dawn-dusk';
  if (kind === 'orbital-sunrise') return orbitalSunrise(now, opts);
  if (kind === 'feature-flyover') return featureFlyover(now, opts) ?? dawnDusk(now, opts);
  return dawnDusk(now, opts);
}
