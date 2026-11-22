// Scene layers the `fx=` preview parameter can switch off, so each one's frame cost can be
// measured (scripts/posters/bench.mjs). To add a layer, list it here and skip it where it's built.

export const FX_LAYERS = {
  shadows: 'Terrain shadows cast across the surface',
  bloom: 'Bloom glow in post-processing',
  glint: 'Sun glint on the sea',
} as const;

export type FxLayer = keyof typeof FX_LAYERS;

const isFxLayer = (s: string): s is FxLayer => Object.hasOwn(FX_LAYERS, s);

/** The layers an `fx=` value disables. Unknown names are ignored. */
export function parseFx(raw: string | null | undefined): Set<FxLayer> {
  const names = (raw ?? '').split(',').map((s) => s.trim().toLowerCase());
  return new Set(names.filter(isFxLayer));
}
