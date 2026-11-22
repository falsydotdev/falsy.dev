import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { cloudReadout, cloudUv, overCloudCap } from '../../src/scene/clouds.ts';
import { orbitCameraPose } from '../../src/scene/camera.ts';
import { EARTH } from '../../src/scene/bodies.ts';
// @ts-expect-error The cloud job is plain JS outside the type-checked tree.
import { readGmgsi } from '../../clouds/container/gmgsi.js';
// @ts-expect-error The cloud job is plain JS outside the type-checked tree.
import { processClouds } from '../../clouds/container/process.js';

const W = 4096;
const H = 2048;
let grid: any;
let opacity: Uint8Array;

beforeAll(async () => {
  grid = await readGmgsi(readFileSync(new URL('../clouds/fixtures/gmgsi-lw-stride16.nc', import.meta.url)));
  const warm = new Uint8Array(W * H).fill(30);
  ({ opacity } = processClouds({ grid, history: [{ day: '20261121', plane: warm }], source: { bucket: 'b', key: 'k' } }));
});

const at = (u: number, v: number) => opacity[Math.min(H - 1, Math.floor(v * H)) * W + Math.min(W - 1, Math.floor(u * W))];

describe('cloud texture coordinates', () => {
  it('find the cloud the source grid puts at a latitude and longitude', () => {
    // The coldest source pixels away from the edges are thick cloud in the job's own grid.
    const picks: [number, number][] = [];
    for (let r = 20; r < grid.height - 20; r++) {
      for (let c = 20; c < grid.width - 20; c++) {
        if (grid.counts[r * grid.width + c] > 200) picks.push([grid.lat[r], grid.lon[c]]);
      }
    }
    expect(picks.length).toBeGreaterThan(10);
    for (const [lat, lon] of picks) {
      const [u, v] = cloudUv(lat, lon);
      expect(at(u, v)).toBeGreaterThan(200);
    }
  });

  it('put 90°N on the top row and 180°W on the first column, wrapping east-positive longitudes', () => {
    expect(cloudUv(90, -180)).toEqual([0, 0]);
    expect(cloudUv(-90, 0)).toEqual([0.5, 1]);
    expect(cloudUv(0, 90)[0]).toBeCloseTo(0.75, 12);
    expect(cloudUv(0, 270)[0]).toBeCloseTo(0.25, 12);
  });
});

const DEG = Math.PI / 180;
const POLAR = { north: 72.7154, south: -72.7368 };
// A camera 400 km over (lat, lon) heading north (or south), pitched down by `tiltDeg` past the horizon dip.
function view(lat: number, lon: number, heading: 'north' | 'south', tiltDeg: number) {
  const r = EARTH.radiusKm + 400;
  const [p, l] = [lat * DEG, lon * DEG];
  const pos = [r * Math.cos(p) * Math.cos(l), r * Math.cos(p) * Math.sin(l), r * Math.sin(p)] as const;
  const s = heading === 'north' ? 1 : -1;
  const vel = [-Math.sin(p) * Math.cos(l) * s, -Math.sin(p) * Math.sin(l) * s, Math.cos(p) * s] as const;
  return orbitCameraPose([...pos], [...vel], EARTH.radiusKm, tiltDeg);
}

describe('the polar cap label', () => {
  it('goes by the ground the view looks at, not the ground below the camera', () => {
    // From 400 km, 15° past the horizon dip looks about 10° of arc ahead.
    expect(overCloudCap(view(68, 0, 'north', 15), EARTH.radiusKm, POLAR)).toBe(true);
    expect(overCloudCap(view(68, 0, 'south', 15), EARTH.radiusKm, POLAR)).toBe(false);
    expect(overCloudCap(view(76, 0, 'south', 15), EARTH.radiusKm, POLAR)).toBe(false);
    expect(overCloudCap(view(-68, 0, 'south', 15), EARTH.radiusKm, POLAR)).toBe(true);
  });

  it('applies on both caps, looking straight down', () => {
    expect(overCloudCap(view(73, 10, 'north', 70.2), EARTH.radiusKm, POLAR)).toBe(true);
    expect(overCloudCap(view(72.5, 10, 'north', 70.2), EARTH.radiusKm, POLAR)).toBe(false);
    expect(overCloudCap(view(-72.9, 10, 'north', 70.2), EARTH.radiusKm, POLAR)).toBe(true);
    expect(overCloudCap(view(-72.6, 10, 'north', 70.2), EARTH.radiusKm, POLAR)).toBe(false);
  });

  it("doesn't label the satellites' no-data wedge below the cap", () => {
    // Saturated pixels flagged as no data around 69–72.7°N, 22–94°E read as clear sky, not as a cap.
    expect(overCloudCap(view(70.5, 50, 'north', 70.2), EARTH.radiusKm, POLAR)).toBe(false);
  });

  it('uses the horizon when the view centre is sky', () => {
    expect(overCloudCap(view(60, 0, 'north', -30), EARTH.radiusKm, POLAR)).toBe(true);
    expect(overCloudCap(view(60, 0, 'south', -30), EARTH.radiusKm, POLAR)).toBe(false);
  });
});

describe('the cloud readout', () => {
  it('says the clouds are a static map with synthesised detail', () => {
    expect(cloudReadout({ source: 'static', status: 'ready', overCap: false })).toBe('clouds: static map, detail synthesised');
  });

  it('says when the view is over a cap without cloud data', () => {
    expect(cloudReadout({ source: 'static', status: 'ready', overCap: true })).toBe('clouds: no polar data');
  });

  it('says nothing while the map loads, and says so when it failed', () => {
    expect(cloudReadout({ source: 'static', status: 'loading', overCap: false })).toBeNull();
    expect(cloudReadout({ source: 'static', status: 'failed', overCap: true })).toBe('clouds: unavailable');
  });
});
