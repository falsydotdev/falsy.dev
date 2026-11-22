// Type-only, so the page's main bundle can read body configs without loading the ephemeris library.
import type * as A from 'astronomy-engine';
import type { Atmosphere } from './atmosphere-luts.ts';
import { EARTH_FEATURES, type Feature, MARS_FEATURES, MOON_FEATURES } from './features.ts';
import type { ShotKind } from './shots.ts';
import { COLOR_LAYER, HEIGHT_LAYER, LIGHTS_LAYER, type TileLayer } from './tiles/layers.ts';

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
  // A cloud layer: one global coverage map drawn as a shell at a fixed height.
  clouds?: {
    // The fallback set's pointer, shaped like the cloud bucket's latest.json. The live base URL is
    // site config (PUBLIC_CLOUDS_BASE), like the tiles'.
    staticUrl: string;
    heightKm: number;
    albedo: number;
    // How far full cover stands above clear sky when shading the clouds from their coverage's slope.
    reliefKm: number;
  };
  // City lights, from a tile layer with id 'lights': emission in the ground's own light units.
  lights?: {
    color: RGB;
    intensity: number; // emission of a full-white source pixel
    // Sine of the Sun's elevation at the ground over which the lights fade in, from none to full.
    fadeSin: readonly [number, number];
  };
  // Heights below 0 are sea, drawn flat at sea level; the sea floor stays in the tiles for shading.
  seaLevel?: boolean;
  // How the sea shades where the colour tiles' water mask says water. Needs `seaLevel`.
  ocean?: Ocean;
  // The streamed tile layers. Colour and height are required; the terrain draws without the rest.
  tiles: { version: string; layers: TileLayer[] };
  shots: {
    weights: Partial<Record<ShotKind, number>>;
    // How far into daylight the terminator orbit runs. Without air there's no skylight, so an
    // orbit right on the terminator looks down on ground that is almost all in shadow.
    dawnDuskSunDeg: number;
    sunriseLeadS: number; // how long before the Sun clears the limb the sunrise shot starts
    // Height of the limb the Sun has to clear. Exaggerated limb mountains hold sunrise back by
    // most of a minute, which on an airless body would mean a long black opening.
    sunriseLimbKm: number;
    // Sun elevation on the ground ahead below which the view is close to black without city
    // lights, from renders. Haze keeps Mars lit past its terminator; the bare Moon goes dark before it.
    darkBelowDeg: number;
    // The night pass, for a body with city lights (light is 0 to 1). The track passes a city whose
    // 1° cell is above `cityAbove`, and holds while light within `reachKm` of the ground ahead is above `holdAbove`.
    nightPass?: { cityAbove: number; reachKm: number; holdAbove: number };
    // The once-per-visitor flyover beside their home region. Only where visitors live.
    homePass?: boolean;
  };
  // Offered in production's first-visit picks and the switch button. A body whose production
  // tiles aren't uploaded yet stays off; `?body=` and development still show it.
  listed: boolean;
  // Held to the spec's GPU memory ceilings (gpu-memory.ts): smaller atlases where a ceiling is
  // lower, and no MSAA where its buffers wouldn't fit. Mars and the Moon predate the ceilings.
  memoryCeilings?: boolean;
}

export interface Ocean {
  windMs: number; // sets the glint's spread through Cox and Munk's slope variance
  deep: RGB; // water-leaving colour over deep ocean, as a linear albedo
  shallow: RGB; // and over a sandy shelf
  shallowDepthM: number; // depth over which the shallow tint fades to deep
  skyLight: number; // brightness of the sky the sea reflects, per unit of sunlight
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
  listed: true,
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
  listed: true,
};

// GM from the IERS conventions; radius is the sphere GEBCO heights are drawn on. Latitude on it is
// geodetic, as the bake reads its rasters, so local Sun elevation and feature placement are exact.
export const EARTH: Body = {
  id: 'earth',
  name: 'Earth',
  spokenName: 'Earth',
  loadingLabel: 'Earth terrain',
  dataCredit: 'GEBCO elevation, Sentinel-2 and Blue Marble colour, Black Marble city lights, and GMGSI cloud data',
  ae: 'Earth' as A.Body,
  gm: 398600.4,
  radiusKm: 6371,
  // The ISS's altitude.
  altKm: 400,
  relief: 2.5,
  features: EARTH_FEATURES,
  sunDiameterRad: 0.0093,
  showsEarth: false,
  glowKm: 55,
  // Hillaire (2020), table 1. The ground matches the shell at about π × sunIntensity, 10.7, which
  // read milky over the sea in renders; 8 keeps coastlines clear and the limb bright.
  atmosphere: {
    topKm: 100,
    groundAlbedo: [0.3, 0.3, 0.3],
    intensity: 8,
    // The 1.2 km haze and the ozone layer are thin next to a 2,000 km limb ray.
    viewSamples: 'lowest',
    components: [
      { scattering: [5.802e-3, 13.558e-3, 33.1e-3], absorption: [0, 0, 0], profile: { scaleHeightKm: 8 }, phase: 'rayleigh' },
      { scattering: [3.996e-3, 3.996e-3, 3.996e-3], absorption: [0.444e-3, 0.444e-3, 0.444e-3], profile: { scaleHeightKm: 1.2 }, phase: [0.8, 0.8, 0.8] },
      { scattering: [0, 0, 0], absorption: [0.65e-3, 1.881e-3, 0.085e-3], profile: { tent: { bottomKm: 10, peakKm: 25, topKm: 40 } } },
    ],
  },
  light: {
    sunColor: [1, 0.98, 0.95],
    sunIntensity: 3.4,
    ambient: 0.03,
    skyTint: [0.55, 0.7, 1],
  },
  seaLevel: true,
  // 7 m/s is roughly the global mean over the oceans (unsourced; Young et al. 2020 would confirm).
  ocean: { windMs: 7, deep: [0.004, 0.014, 0.035], shallow: [0.03, 0.09, 0.1], shallowDepthM: 30, skyLight: 0.3 },
  // The spec's twilight: Sun 2.9° up to 8.6° down. Warm white, between sodium and LED street lighting.
  lights: { color: [1, 0.82, 0.6], intensity: 3, fadeSin: [0.05, -0.15] },
  // The static map: GMGSI for 2026-11-22 11:00 UTC against the 14 days before it.
  clouds: { staticUrl: '/clouds/static.json', heightKm: 8, albedo: 0.85, reliefKm: 12 },
  // Colour stops at level 6 and carries the water mask in alpha (opaque is land).
  tiles: { version: 'v1', layers: [{ ...COLOR_LAYER, format: 'masked', maxLevel: 6 }, HEIGHT_LAYER, LIGHTS_LAYER] },
  // Named places lead because visitors know them by sight; one load in five shows the night side's cities.
  // Heading into night, renders dim to 7 of 255 at −5° and are close to black by −6°.
  shots: { weights: { 'dawn-dusk': 0.25, 'orbital-sunrise': 0.25, 'feature-flyover': 0.3, 'night-pass': 0.2 }, dawnDuskSunDeg: 4, sunriseLeadS: 60, sunriseLimbKm: 0, darkBelowDeg: -5, nightPass: { cityAbove: 1e-2, reachKm: 500, holdAbove: 3e-3 }, homePass: true },
  listed: false,
  memoryCeilings: true,
};

export const BODIES: Record<string, Body> = { mars: MARS, moon: MOON, earth: EARTH };

/** The bodies first visits pick from and the switch button cycles through, in switch order. */
export const listedBodyIds = (dev: boolean): string[] => Object.values(BODIES).filter((b) => b.listed || dev).map((b) => b.id);

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
