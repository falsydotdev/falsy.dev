import { describe, expect, it } from 'vitest';
import { type Vec3, vec } from '../../src/scene/ephemeris.ts';
import { fresnel, slopeVariance, specularPoint } from '../../src/scene/ocean.ts';

describe('slopeVariance', () => {
  it('follows Cox and Munk for a clean sea', () => {
    expect(slopeVariance(0)).toBeCloseTo(0.003, 6);
    // Cox and Munk's own check: about (tan 16°)² at 14 m/s.
    expect(slopeVariance(14)).toBeCloseTo(0.0747, 3);
    expect(slopeVariance(7)).toBeCloseTo(0.0388, 3);
  });
});

describe('fresnel', () => {
  // Unpolarised reflectance of water (n = 1.333) from the full Fresnel equations, by incidence angle.
  const exact: [number, number][] = [[0, 0.0204], [60, 0.0597], [80, 0.3479], [85, 0.5835], [89, 0.8963]];

  it('reflects about 2% looking straight down and everything at grazing', () => {
    expect(fresnel(1)).toBeCloseTo(0.0204, 3);
    expect(fresnel(0)).toBeCloseTo(1, 6);
  });

  it('stays within 0.06 of the exact reflectance at every angle', () => {
    for (const [deg, r] of exact) expect(Math.abs(fresnel(Math.cos((deg * Math.PI) / 180)) - r)).toBeLessThan(0.06);
  });
});

describe('specularPoint', () => {
  const R = 6371;
  const camera: Vec3 = [R + 400, 0, 0];
  const angle = (a: Vec3, b: Vec3) => Math.acos(Math.min(1, vec.dot(vec.norm(a), vec.norm(b))));
  // A Sun `deg` above the camera's horizon, ahead along +y.
  const sunAt = (deg: number): Vec3 => [Math.sin((deg * Math.PI) / 180), Math.cos((deg * Math.PI) / 180), 0];

  it('lies straight below the camera when the Sun is overhead', () => {
    const p = specularPoint(camera, [1, 0, 0], R)!;
    expect(p[0]).toBeCloseTo(1, 9);
  });

  it('reflects the Sun into the camera: equal angles, in the plane of camera and Sun', () => {
    const sun = vec.norm([0.3, 0.8, 0.5]);
    const p = specularPoint(camera, sun, R)!;
    const toCamera = vec.sub(camera, vec.scale(p, R));
    expect(angle(p, sun)).toBeCloseTo(angle(p, toCamera), 6);
    expect(vec.dot(p, vec.norm(vec.cross(camera, sun)))).toBeCloseTo(0, 9);
  });

  it('sits toward the Sun where the sphere mirrors it', () => {
    // Ground distances from a brute-force scan of the mirror condition on the sphere, 10 m steps.
    for (const [deg, km] of [[60, 200.2], [45, 331.5], [30, 515.3]]) {
      expect(angle(specularPoint(camera, sunAt(deg), R)!, camera) * R).toBeCloseTo(km, 0);
    }
  });

  it('has no glint when the Sun is behind the planet', () => {
    expect(specularPoint(camera, [-1, 0, 0], R)).toBeNull();
    expect(specularPoint(camera, sunAt(-30), R)).toBeNull();
  });
});
