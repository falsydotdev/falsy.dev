import { describe, expect, it } from 'vitest';
import { leafLevelArg } from '../../scripts/tiles/leaf-level.ts';

const range = { min: 3, max: 7 };
const argv = (...args: string[]) => ['node', 'colour.mjs', '--body', 'earth', ...args];

describe('the --leaf-level argument', () => {
  it('cuts leaves at the deepest level by default', () => {
    expect(leafLevelArg(argv(), range)).toBe(7);
  });

  it('takes any level from the job level to the deepest', () => {
    expect(leafLevelArg(argv('--leaf-level', '3'), range)).toBe(3);
    expect(leafLevelArg(argv('--leaf-level', '7'), range)).toBe(7);
  });

  it('rejects a level the bake would recurse below forever, or never reach', () => {
    for (const value of ['2', '0', '-1', '8']) {
      expect(() => leafLevelArg(argv('--leaf-level', value), range)).toThrow(/--leaf-level .*3 to 7/);
    }
  });

  it('rejects a missing or non-integer value', () => {
    expect(() => leafLevelArg(argv('--leaf-level'), range)).toThrow(/--leaf-level/);
    expect(() => leafLevelArg(argv('--leaf-level', '--near', '1,2,3'), range)).toThrow(/--leaf-level/);
    for (const value of ['', '4.5', '0x4', 'five', '4abc']) {
      expect(() => leafLevelArg(argv('--leaf-level', value), range)).toThrow(/--leaf-level/);
    }
  });
});
