/**
 * The `--leaf-level <n>` argument: the level whose tiles a bake cuts from the source, from the job
 * level to the layer's deepest. Defaults to the deepest. Below the job level the bake never stops.
 */
export function leafLevelArg(argv: readonly string[], { min, max }: { min: number; max: number }): number {
  const i = argv.indexOf('--leaf-level');
  if (i < 0) return max;
  const value = argv[i + 1];
  const level = value !== undefined && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!(level >= min && level <= max)) throw new Error(`--leaf-level takes a whole number from ${min} to ${max}; got ${value === undefined ? 'nothing' : JSON.stringify(value)}`);
  return level;
}
