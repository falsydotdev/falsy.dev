// Scene layers the `fx=` preview parameter can switch off, so each one's frame cost can be
// measured (scripts/posters/bench.mjs). To add a layer, list it here and skip it where it's built.

export const FX_LAYERS = {
  shadows: 'Terrain shadows cast across the surface',
  bloom: 'Bloom glow in post-processing',
  clouds: "Earth's cloud layer, with its shadows",
  cloudShadows: 'Cloud shadows on the ground',
} as const;

export type FxLayer = keyof typeof FX_LAYERS;

const byLowerCase = new Map(Object.keys(FX_LAYERS).map((k) => [k.toLowerCase(), k as FxLayer]));

/** The layers an `fx=` value disables. Unknown names are ignored. */
export function parseFx(raw: string | null | undefined): Set<FxLayer> {
  const names = (raw ?? '').split(',').map((s) => byLowerCase.get(s.trim().toLowerCase()));
  return new Set(names.filter((n): n is FxLayer => n !== undefined));
}
