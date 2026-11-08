// Type-only, so the page's main bundle can read body configs without loading the ephemeris library.
import type * as A from 'astronomy-engine';
import { type Feature, MARS_FEATURES } from './features.ts';

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
  // The Sun's apparent diameter, which sets terrain shadow penumbrae. The disc is drawn twice
  // this size so it still reads on screen.
  sunDiameterRad: number;
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
};

export const BODIES: Record<string, Body> = { mars: MARS };

export const bodyById = (id: string | null | undefined): Body => (id && BODIES[id]) || MARS;
