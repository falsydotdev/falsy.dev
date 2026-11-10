// Type-only, so the page's main bundle can read body configs without loading the ephemeris library.
import type * as A from 'astronomy-engine';
import { type Feature, MARS_FEATURES, MOON_FEATURES } from './features.ts';

export type RGB = readonly [number, number, number];

export interface Body {
  id: string;
  name: string;
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
  // Dust density for the scattering shell and the surface haze; null for an airless body.
  atmosphere: { density: number } | null;
  light: {
    sunColor: RGB;
    sunIntensity: number;
    ambient: number;
    skyTint: RGB; // colour of the diffuse skylight on the ground
    extinction: RGB; // per-channel haze extinction relative to green
  };
  tiles: { version: string };
  shots: {
    weights: Record<'dawn-dusk' | 'orbital-sunrise' | 'feature-flyover' | 'earthrise', number>;
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

// GM from JPL DE440. Radius is the MOLA reference sphere.
export const MARS: Body = {
  id: 'mars',
  name: 'Mars',
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
  atmosphere: { density: 0.2 },
  light: {
    sunColor: [1, 0.95, 0.88],
    sunIntensity: 3.4,
    ambient: 0.015,
    skyTint: [1, 0.72, 0.5],
    extinction: [0.85, 1, 1.25],
  },
  tiles: { version: 'v1' },
  shots: { weights: { 'dawn-dusk': 0.4, 'orbital-sunrise': 0.3, 'feature-flyover': 0.3, earthrise: 0 }, dawnDuskSunDeg: 0, sunriseLeadS: 60, sunriseLimbKm: 0, darkBelowDeg: -4 },
};

// GM from JPL DE440. Radius is the 1737.4 km sphere LOLA heights are measured from.
export const MOON: Body = {
  id: 'moon',
  name: 'Moon',
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
    extinction: [1, 1, 1],
  },
  tiles: { version: 'v1' },
  // An airless sunrise opens on a black limb and lights only a sliver for minutes, so it's left
  // out of the mix; `?shot=orbital-sunrise` still shows it. A long lead would open on black.
  shots: { weights: { 'dawn-dusk': 0.4, 'orbital-sunrise': 0, 'feature-flyover': 0.3, earthrise: 0.3 }, dawnDuskSunDeg: 10, sunriseLeadS: 15, sunriseLimbKm: 15, darkBelowDeg: 4 },
};

export const BODIES: Record<string, Body> = { mars: MARS, moon: MOON };

export const bodyById = (id: string | null | undefined): Body => (id && BODIES[id]) || MARS;
