import { describe, expect, it } from 'vitest';
import { FX_LAYERS, parseFx } from '../../src/scene/fx.ts';

describe('parseFx', () => {
  it('disables nothing without the parameter', () => {
    expect(parseFx(null).size).toBe(0);
    expect(parseFx(undefined).size).toBe(0);
    expect(parseFx('').size).toBe(0);
  });

  it('takes a comma-separated list of layers to disable', () => {
    expect([...parseFx('shadows,bloom')].sort()).toEqual(['bloom', 'shadows']);
  });

  it('ignores unknown names, blanks, case, and spaces', () => {
    expect([...parseFx(' Bloom , ,sparkles,')]).toEqual(['bloom']);
    expect(parseFx('sparkles').size).toBe(0);
  });

  it('knows the layers that exist today', () => {
    expect(Object.keys(FX_LAYERS)).toEqual(expect.arrayContaining(['shadows', 'bloom', 'glint']));
  });
});
