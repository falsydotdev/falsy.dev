// Type-only, so the page's main bundle can read body configs without loading the ephemeris library.
import type * as A from 'astronomy-engine';
import type { Atmosphere } from './atmosphere-luts.ts';
import { type Feature, MARS_FEATURES, MOON_FEATURES } from './features.ts';
import { COLOR_LAYER, HEIGHT_LAYER, type TileLayer } from './tiles/layers.ts';

export type RGB = readonly [number, number, number];

export interface Body {
  id: string;
  name: string;
  spokenName: string; // the name inside a sentence, as in "Switch to the Moon"
  loadingLabel: string; // completes "Loading …" while the live scene starts
  dataCredit: string; // completes "A still frame rendered from …" in a poster's description
  ae: A.Body;
  gm: number; // km³/s²
  radiusKm: number; // the reference sphere the terrain heights are measured from
  altKm: number; // default orbit altitude
  relief: number; // vertical exaggeration
  features: Feature[];
  // The Sun's apparent diameter: the disc's drawn size, and the width of terrain shadow penumbrae.
  sunDiameterRad: number;
  showsEarth: boolean; // Earth hangs in this body's sky and is drawn there
  // Height of the bright shell above the limb that framing keeps clear of the text. 0 without air.
  glowKm: number;
  // The air's components, which light the scattering shell and the ground; null for an airless body.
  atmosphere: Atmosphere | null;
  light: {
    sunColor: RGB;
    sunIntensity: number;
    ambient: number;
    skyTint: RGB; // colour of the diffuse skylight on the ground
  };
  // The streamed tile layers. Colour and height are required; the terrain draws without the rest.
  tiles: { version: string; layers: TileLayer[] };
  shots: {
    weights: Partial<Record<'dawn-dusk' | 'orbital-sunrise' | 'feature-flyover' | 'earthrise', number>>;
    // How far into daylight the terminator orbit runs. Without air there's no skylight, so an
    // orbit right on the terminator looks down on ground that is almost all in shadow.
    dawnDuskSunDeg: number;
    sunriseLeadS: number; // how long before the Sun clears the limb the sunrise shot starts
    // Height of the limb the Sun has to clear. Exaggerated limb mountains hold sunrise back by
    // most of a minute, which on an airless body would mean a long black opening.
    sunriseLimbKm: number;
    // Sun elevation on the ground ahead below which the view is close to black, from renders.
    // Haze keeps Mars lit past its terminator; the bare Moon goes dark before it.
    darkBelowDeg: number;
  };
}

// Mars's dust load scales its clear-air values; 0.2 is a moderately dusty day.
const MARS_DUST = 0.2;
const dusty = (c: RGB): RGB => [c[0] * MARS_DUST, c[1] * MARS_DUST, c[2] * MARS_DUST];

// GM from JPL DE440. Radius is the MOLA reference sphere.
export const MARS: Body = {
  id: 'mars',
  name: 'Mars',
  spokenName: 'Mars',
  loadingLabel: 'Mars terrain',
  dataCredit: 'MOLA elevation and Viking colour data',
  ae: 'Mars' as A.Body,
  gm: 42828.37,
  radiusKm: 3396.19,
  altKm: 200,
  relief: 2.5,
  features: MARS_FEATURES,
  sunDiameterRad: 0.0061,
  showsEarth: false,
  // About three scale heights of dust, 11 km each.
  glowKm: 35,
  atmosphere: {
    topKm: 110,
    groundAlbedo: [0.3, 0.2, 0.13],
    intensity: 16,
    components: [
      { scattering: dusty([1.45e-4, 3.4e-4, 8.3e-4]), absorption: [0, 0, 0], profile: { scaleHeightKm: 11 }, phase: 'rayleigh' },
      // Dust scatters blue light more tightly around the Sun, which gives the blue Martian sunset.
      { scattering: dusty([0.042, 0.03, 0.019]), absorption: dusty([0.004, 0.016, 0.027]), profile: { scaleHeightKm: 11 }, phase: [0.62, 0.7, 0.82] },
    ],
    // The ground's haze was tuned by eye before it read the tables, warmer and denser than the
    // shell's; this keeps that look.
    groundHaze: [1.07, 1.25, 1.55],
  },
  light: {
    sunColor: [1, 0.95, 0.88],
    sunIntensity: 3.4,
    ambient: 0.015,
    skyTint: [1, 0.72, 0.5],
  },
  tiles: { version: 'v1', layers: [COLOR_LAYER, HEIGHT_LAYER] },
  shots: { weights: { 'dawn-dusk': 0.4, 'orbital-sunrise': 0.3, 'feature-flyover': 0.3 }, dawnDuskSunDeg: 0, sunriseLeadS: 60, sunriseLimbKm: 0, darkBelowDeg: -4 },
};

// GM from JPL DE440. Radius is the 1737.4 km sphere LOLA heights are measured from.
export const MOON: Body = {
  id: 'moon',
  name: 'Moon',
  spokenName: 'the Moon',
  loadingLabel: 'lunar terrain',
  dataCredit: 'LOLA elevation and LROC colour data',
  ae: 'Moon' as A.Body,
  gm: 4902.8,
  radiusKm: 1737.4,
  // About the altitude LRO mapped from.
  altKm: 100,
  relief: 2.5,
  features: MOON_FEATURES,
  sunDiameterRad: 0.0093,
  showsEarth: true,
  // No air, but exaggerated mountains on the limb rise about 25 km.
  glowKm: 15,
  atmosphere: null,
  light: {
    sunColor: [1, 0.98, 0.95],
    sunIntensity: 3.4,
    ambient: 0,
    skyTint: [1, 1, 1],
  },
  tiles: { version: 'v1', layers: [COLOR_LAYER, HEIGHT_LAYER] },
  // An airless sunrise opens on a black limb and lights only a sliver for minutes, so it's left
  // out of the mix; `?shot=orbital-sunrise` still shows it. A long lead would open on black.
  shots: { weights: { 'dawn-dusk': 0.4, 'orbital-sunrise': 0, 'feature-flyover': 0.3, earthrise: 0.3 }, dawnDuskSunDeg: 10, sunriseLeadS: 15, sunriseLimbKm: 15, darkBelowDeg: 4 },
};

export const BODIES: Record<string, Body> = { mars: MARS, moon: MOON };

// Baked ahead of Earth becoming a body; the Earth body takes its radius and tiles from here.
// Colour stops at level 6 and carries the water mask in alpha (opaque is land).
export const EARTH_RADIUS_KM = 6371;
export const EARTH_TILES: Body['tiles'] = { version: 'v1', layers: [{ ...COLOR_LAYER, format: 'masked', maxLevel: 6 }, HEIGHT_LAYER] };

export const bodyById = (id: string | null | undefined): Body => (id && BODIES[id]) || MARS;

// Falls back to `id` itself when no other body is eligible.
export function nextBodyId(ids: readonly string[], id: string, eligible: (id: string) => boolean = () => true): string {
  const start = ids.indexOf(id);
  for (let step = 1; step <= ids.length; step++) {
    const next = ids[(start + step) % ids.length];
    if (next !== id && eligible(next)) return next;
  }
  return id;
}
