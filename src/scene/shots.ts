import { type Vec3, DEG, vec, bodyFrame, fromBody, sunFrom, bodyVector, sunElevationAt, earthFromMoon, earthLitFraction } from './ephemeris.ts';
import { type CircularOrbit, circularOrbit, stateAt } from './orbit.ts';
import { type Body, MARS } from './bodies.ts';
import type { Feature } from './features.ts';

export type ShotKind = 'dawn-dusk' | 'orbital-sunrise' | 'feature-flyover' | 'earthrise';

export interface Shot {
  kind: ShotKind;
  orbit: CircularOrbit;
  feature?: Feature;
  // When the moment the shot is built around happens: shadow exit, the pass over the feature, or
  // Earth's centre clearing the limb.
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
const FLYOVER_LIT_MARGIN_DEG = 2;
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

// Where the camera passes the feature, and its Sun elevation there.
function flyoverTrack(body: Body, pass: Date, feature: Feature) {
  const f = fromBody(bodyFrame(body, pass), bodyVector(feature.lat, feature.lon));
  const sun = sunFrom(body, pass);
  const along = vec.norm(vec.cross(f, sun));
  const offset = FLYOVER_OFFSET_KM / body.radiusKm;
  const track = vec.sub(vec.scale(f, Math.cos(offset)), vec.scale(cameraRight(f, along), Math.sin(offset)));
  return { track, along, sunDeg: Math.asin(vec.dot(track, sun)) / DEG };
}

/** Low-Sun features whose flyover keeps the ground under the camera lit. */
export function flyoverFeatures(body: Body, pass: Date, features: Feature[] = body.features) {
  // The track runs on the night side of the feature, so on the Moon it can be dark while the feature is lit.
  return lowSunFeatures(body, pass, features).filter((f) => flyoverTrack(body, pass, f).sunDeg >= body.shots.darkBelowDeg + FLYOVER_LIT_MARGIN_DEG);
}

// An orbit whose ground track passes a low-Sun feature a few minutes after load, with the
// feature off to the right. It travels along the local terminator so the Sun stays to the
// right too. `anySun` drops the low-Sun filter, for previewing one feature at any time of day.
export function featureFlyover(now: Date, opts: ShotOptions & { features?: Feature[]; anySun?: boolean } = {}): Shot | null {
  const { body, altKm } = resolve(opts);
  const rand = opts.rand ?? Math.random;
  const pass = new Date(now.getTime() + FLYOVER_LEAD_S * 1000);
  const candidates = opts.anySun ? (opts.features ?? body.features) : flyoverFeatures(body, pass, opts.features);
  if (candidates.length === 0) return null;
  const feature = candidates[Math.floor(rand() * candidates.length)];
  const { track, along } = flyoverTrack(body, pass, feature);
  const probe = circularOrbit(body, now, altKm, track, along, 0);
  const orbit = { ...probe, theta0: -probe.n * FLYOVER_LEAD_S };
  return { kind: 'feature-flyover', orbit, feature, keyMoment: pass };
}

// A narrower lens for shots built around something small and far, as Apollo 8 used for Earthrise.
// Every other shot uses the scene's default.
export const SHOT_FOV_DEG: Partial<Record<ShotKind, number>> = { earthrise: 28 };

const EARTHRISE_LEAD_S = 20;
// Earth is only worth a shot when enough of it is lit, and the ground it rises over is too.
const EARTHRISE_MIN_LIT = 1 / 3;
const EARTHRISE_GROUND_SUN = { min: 8, max: 30 };
const EARTHRISE_MIN_LIT_S = 240;
// How far along the orbit the ground in view lies. Earthrise's narrow lens sees mostly far ground
// toward the horizon (19° ahead at 100 km); 15° keeps swaps on a lit frame in renders.
const LOOK_AHEAD_DEG = 8;
const EARTHRISE_LOOK_AHEAD_DEG = 15;
const lookAheadDeg = (kind: ShotKind) => (kind === 'earthrise' ? EARTHRISE_LOOK_AHEAD_DEG : LOOK_AHEAD_DEG);
const LIT_SCAN_S = 1800;

/** The Sun's elevation on the ground `aheadDeg` of orbit in front of the camera. `sun` fixes its direction. */
export function sunAhead(orbit: CircularOrbit, date: Date, aheadDeg = LOOK_AHEAD_DEG, sun?: Vec3) {
  const ahead = new Date(date.getTime() + ((aheadDeg * DEG) / orbit.n) * 1000);
  return Math.asin(vec.dot(vec.norm(stateAt(orbit, ahead).r), sun ?? sunFrom(orbit.body, ahead))) / DEG;
}

/** An orbit that brings Earth up over the limb, right of the track, over lit ground. Null when none qualifies. */
export function earthrise(now: Date, opts: ShotOptions & { rightDeg?: number } = {}): Shot | null {
  const { body, altKm } = resolve(opts);
  if (!body.showsEarth) return null;
  const rand = opts.rand ?? Math.random;
  const key = new Date(now.getTime() + EARTHRISE_LEAD_S * 1000);
  const sun = sunFrom(body, key);
  if (earthLitFraction(key, sun) < EARTHRISE_MIN_LIT) return null;
  const earth = vec.norm(earthFromMoon(key));
  const [p, q] = perpendicularBasis(earth, bodyFrame(body, key).z);
  const tip = (opts.rightDeg ?? 12) * DEG;
  const a = body.radiusKm + altKm;
  // Earth's centre clears limb mountains this high when it sits this far below the bare horizon.
  const dip = Math.acos((body.radiusKm + body.shots.sunriseLimbKm) / a);
  const thetaRise = -Math.acos(-Math.sin(dip) / Math.cos(tip));
  // Seen from the Moon the Sun moves under half a degree an hour, so a fixed direction will do.
  const litFor = (o: CircularOrbit) => {
    for (let t = 0; t < LIT_SCAN_S; t += 30) {
      if (sunAhead(o, new Date(key.getTime() + t * 1000), EARTHRISE_LOOK_AHEAD_DEG, sun) < body.shots.darkBelowDeg) return t;
    }
    return LIT_SCAN_S;
  };
  const candidates: { orbit: CircularOrbit; lit: number }[] = [];
  for (let i = 0; i < 72; i++) {
    const phi = (i / 72) * 2 * Math.PI;
    const u = vec.add(vec.scale(p, Math.cos(phi)), vec.scale(q, Math.sin(phi)));
    // Tipping the plane toward earth × u puts Earth on the camera's right.
    const e1 = vec.add(vec.scale(earth, Math.cos(tip)), vec.scale(vec.cross(earth, u), Math.sin(tip)));
    const probe = circularOrbit(body, key, altKm, e1, u, thetaRise);
    const { r, v } = stateAt(probe, key);
    if (vec.dot(sun, cameraRight(r, v)) <= 0) continue;
    const sunUp = sunAhead(probe, key, EARTHRISE_LOOK_AHEAD_DEG, sun);
    if (sunUp < EARTHRISE_GROUND_SUN.min || sunUp > EARTHRISE_GROUND_SUN.max) continue;
    const orbit = { ...probe, epoch: now, theta0: thetaRise - probe.n * EARTHRISE_LEAD_S };
    const lit = litFor(orbit);
    if (lit >= EARTHRISE_MIN_LIT_S) candidates.push({ orbit, lit });
  }
  if (candidates.length === 0) return null;
  // Toward a nearly full Earth the ground ahead is night, so favour the orbits that stay lit longest.
  const best = Math.max(...candidates.map((c) => c.lit));
  const longest = candidates.filter((c) => c.lit >= best * 0.75);
  return { kind: 'earthrise', orbit: longest[Math.floor(rand() * longest.length)].orbit, keyMoment: key };
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

// How long a shot runs past its key moment before it can be replaced. A sunrise opens with the
// ground below still in shadow while the Sun climbs ahead, so it gets longer to play out.
const RESHOOT_AFTER_S = 120;
const RESHOOT_AFTER_SUNRISE_S = 600;

/** Whether the orbit has carried the camera, long after its shot's moment, toward ground too dark to see. */
export function wantsReshoot(shot: Shot, builtAt: Date, date: Date) {
  const grace = shot.kind === 'orbital-sunrise' ? RESHOOT_AFTER_SUNRISE_S : RESHOOT_AFTER_S;
  if (date.getTime() < (shot.keyMoment ?? builtAt).getTime() + grace * 1000) return false;
  return sunAhead(shot.orbit, date, lookAheadDeg(shot.kind)) < shot.orbit.body.shots.darkBelowDeg;
}

export function chooseShot(now: Date, opts: ShotOptions & { features?: Feature[] } = {}): Shot {
  const rand = opts.rand ?? Math.random;
  const weights = Object.entries(resolve(opts).body.shots.weights) as [ShotKind, number][];
  let roll = rand();
  const kind = weights.find(([, w]) => (roll -= w) < 0)?.[0] ?? 'dawn-dusk';
  if (kind === 'orbital-sunrise') return orbitalSunrise(now, opts);
  if (kind === 'earthrise') return earthrise(now, opts) ?? featureFlyover(now, opts) ?? dawnDusk(now, opts);
  if (kind === 'feature-flyover') return featureFlyover(now, opts) ?? dawnDusk(now, opts);
  return dawnDusk(now, opts);
}
