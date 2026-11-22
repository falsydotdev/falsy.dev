import { EARTH } from './bodies.ts';
import { DEG } from './ephemeris.ts';
import { type Shot, type ShotOptions, type ViewContext, featureFlyover, lookAheadDeg, worthShowing } from './shots.ts';
import type { Place } from './timezone.ts';

// Far enough to the side that the readout never shows the home's own coordinates.
const HOME_OFFSET_KM = 150;

/**
 * A flyover beside the visitor's home region at its real local time, or null when there's no home,
 * the body isn't Earth, or the region would be dark ground without city lights.
 * The shot carries no feature, so the home's coordinates don't travel with it.
 */
export function homePass(now: Date, opts: ShotOptions & { home: Place | null; ctx?: ViewContext }): Shot | null {
  const { home, ctx = {}, ...rest } = opts;
  if (!home || rest.body?.id !== EARTH.id) return null;
  const feature = { id: 'home', name: 'home', lat: home.lat, lon: (home.lon + 360) % 360 };
  // No draw from the caller's random source, so a fallback rolls the shot it would have rolled anyway.
  const flyover = featureFlyover(now, { ...rest, features: [feature], anySun: true, offsetKm: HOME_OFFSET_KM, rand: () => 0 });
  if (!flyover?.keyMoment) return null;
  const shot: Shot = { kind: 'home-pass', orbit: flyover.orbit, keyMoment: flyover.keyMoment };
  // Judged as the camera comes up beside home, when the ground it is heading for is the home region.
  const leadMs = ((lookAheadDeg('home-pass') * DEG) / shot.orbit.n) * 1000;
  return worthShowing(shot, new Date(shot.keyMoment!.getTime() - leadMs), ctx) ? shot : null;
}
