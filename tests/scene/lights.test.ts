import { describe, expect, it } from 'vitest';
import { lightsAround, lightsAt, lightsGrid } from '../../src/scene/lights';

describe("Earth's city-lights lookup", () => {
  it('reads cities as lit and deserts and open ocean as dark', () => {
    expect(lightsAt(52.3, 5.3)).toBeGreaterThan(0.03); // the Randstad
    expect(lightsAt(35.7, 139.7)).toBeGreaterThan(0.2); // Tokyo
    expect(lightsAt(48.85, 2.35)).toBeGreaterThan(0.1); // Paris
    expect(lightsAt(23, 12)).toBeLessThan(1e-4); // central Sahara
    expect(lightsAt(0, -150)).toBe(0); // central Pacific
    expect(lightsAt(-70, 0)).toBe(0); // Antarctica
  });

  it('takes longitude in any turn', () => {
    expect(lightsAt(35.7, 139.7 - 360)).toBe(lightsAt(35.7, 139.7));
    expect(lightsAt(35.7, 139.7 + 360)).toBe(lightsAt(35.7, 139.7));
  });

  it('holds the poles inside the grid', () => {
    expect(lightsAt(90, 0)).toBe(0);
    expect(lightsAt(-90, 0)).toBe(0);
  });

  it('finds coastal lights within reach of a point over the sea', () => {
    expect(lightsAt(54.5, 3.5)).toBeLessThan(1e-3);
    expect(lightsAround(54.5, 3.5, 400)).toBeGreaterThan(0.005);
    expect(lightsAround(0, -150, 400)).toBe(0);
  });

  it('reads one cell when the reach is zero', () => {
    expect(lightsAround(52.3, 5.3, 0)).toBe(lightsAt(52.3, 5.3));
  });

  it('reaches across the antimeridian', () => {
    const grid = lightsGrid(new Uint8Array(360 * 180), 1);
    grid.values[90 * 360 + 359] = 255; // the cell just west of 180° on the equator's south side
    expect(lightsAt(-0.5, 179.5, grid)).toBe(1);
    expect(lightsAround(-0.5, -179.5, 200, grid)).toBeGreaterThan(0);
    expect(lightsAround(-0.5, -170, 200, grid)).toBe(0);
  });
});
