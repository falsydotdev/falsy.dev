import { describe, expect, it } from 'vitest';
import {
  type TileKey,
  children,
  dirOf,
  dirToFace,
  faceDir,
  latLonOf,
  parent,
  parseTileId,
  tileAngularRadius,
  tileAt,
  tileDir,
  tileId,
  tileLatLonBounds,
  tileRect,
} from '../../src/scene/tiles/cube';

const rand = (() => {
  let s = 12345;
  return () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
})();
const randomDir = () => dirOf(Math.asin(rand() * 2 - 1) * (180 / Math.PI), rand() * 360 - 180);
const angle = (a: number[], b: number[]) => Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));

describe('cube-sphere mapping', () => {
  it('round-trips directions through face coordinates', () => {
    for (let i = 0; i < 2000; i++) {
      const d = randomDir();
      const { face, s, t } = dirToFace(d);
      expect(Math.abs(s)).toBeLessThanOrEqual(1 + 1e-12);
      expect(Math.abs(t)).toBeLessThanOrEqual(1 + 1e-12);
      expect(angle(faceDir(face, s, t), d)).toBeLessThan(1e-7);
    }
  });

  it('keeps texel spacing near uniform (equi-angular)', () => {
    // Angle across one step at the face centre versus at the face edge.
    const step = 1 / 256;
    const centre = angle(faceDir(0, 0, 0), faceDir(0, step, 0));
    const edge = angle(faceDir(0, 1 - step, 0), faceDir(0, 1, 0));
    const corner = angle(faceDir(0, 1 - step, 1 - step), faceDir(0, 1, 1 - step));
    expect(edge / centre).toBeCloseTo(1, 2);
    expect(corner / centre).toBeGreaterThan(0.7);
  });

  it('puts lon 0 on face 0, lon 90°E on face 1, and the north pole on face 4', () => {
    expect(dirToFace(dirOf(0, 0)).face).toBe(0);
    expect(dirToFace(dirOf(0, 90)).face).toBe(1);
    expect(dirToFace(dirOf(0, 180)).face).toBe(2);
    expect(dirToFace(dirOf(0, -90)).face).toBe(3);
    expect(dirToFace(dirOf(89, 10)).face).toBe(4);
    expect(dirToFace(dirOf(-89, 10)).face).toBe(5);
  });

  it('agrees on shared edges between neighbouring faces', () => {
    for (let face = 0; face < 6; face++) {
      for (const [s, t] of [[1, 0.3], [-1, -0.5], [0.2, 1], [0.7, -1]]) {
        const d = faceDir(face, s, t);
        const other = dirToFace(d);
        expect(angle(faceDir(other.face, other.s, other.t), d)).toBeLessThan(1e-7);
      }
    }
  });
});

describe('tile tree', () => {
  it('finds the tile containing a direction at every level', () => {
    for (let i = 0; i < 300; i++) {
      const d = randomDir();
      for (let level = 0; level <= 9; level++) {
        const k = tileAt(d, level);
        const c = tileDir(k, 0.5, 0.5);
        expect(angle(c, d)).toBeLessThanOrEqual(tileAngularRadius(k) + 1e-9);
        if (level > 0) expect(tileId(parent(k)!)).toBe(tileId(tileAt(d, level - 1)));
      }
    }
  });

  it('splits into four children that tile the parent exactly', () => {
    const k: TileKey = { face: 3, level: 4, x: 5, y: 11 };
    const r = tileRect(k);
    const kids = children(k).map(tileRect);
    expect(Math.min(...kids.map((c) => c.s0))).toBeCloseTo(r.s0, 12);
    expect(Math.max(...kids.map((c) => c.s0 + c.size))).toBeCloseTo(r.s0 + r.size, 12);
    expect(kids.reduce((a, c) => a + c.size ** 2, 0)).toBeCloseTo(r.size ** 2, 12);
    for (const c of children(k)) expect(tileId(parent(c)!)).toBe(tileId(k));
    expect(parseTileId(tileId(k))).toEqual(k);
  });
});

describe('tile lat/lon bounds', () => {
  it('contain every point of the tile', () => {
    for (let i = 0; i < 400; i++) {
      const d = randomDir();
      const k = tileAt(d, 1 + (i % 8));
      const b = tileLatLonBounds(k);
      const { lat, lon } = latLonOf(d);
      expect(lat).toBeGreaterThanOrEqual(b.latMin);
      expect(lat).toBeLessThanOrEqual(b.latMax);
      const l = lon < b.lonMin ? lon + 360 : lon;
      expect(l).toBeGreaterThanOrEqual(b.lonMin);
      expect(l).toBeLessThanOrEqual(b.lonMax);
    }
  });

  it('span all longitudes for a tile holding a pole', () => {
    const b = tileLatLonBounds(tileAt([0, 0, 1], 5));
    expect(b.latMax).toBe(90);
    expect(b.lonMax - b.lonMin).toBe(360);
  });

  it('stay narrow across the antimeridian', () => {
    const b = tileLatLonBounds(tileAt(dirOf(10, 179.99), 7));
    expect(b.lonMax - b.lonMin).toBeLessThan(2);
    expect(b.lonMax).toBeGreaterThan(180);
  });
});
