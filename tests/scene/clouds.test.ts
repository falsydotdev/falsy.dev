import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { cloudCandidates, cloudReadout, cloudsNewer, cloudsRecheckDue, cloudUv, overCloudCap, type CloudSetInfo } from '../../src/scene/clouds.ts';
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
  const now = new Date('2026-11-22T11:40:00Z');
  const staticMap = { source: 'static', valid: new Date('2026-11-22T11:00:00Z') } as const;
  const ready = (set: CloudSetInfo | null, overCap = false) => cloudReadout({ status: 'ready', set, now, overCap });

  it('says the clouds are a static map with synthesised detail', () => {
    expect(ready(staticMap)).toBe('clouds: static map, detail synthesised');
  });

  it('gives a live set its valid time', () => {
    expect(ready({ source: 'live', valid: new Date('2026-11-22T09:00:00Z') })).toBe('clouds 22 NOV 09:00Z, detail synthesised');
  });

  it('marks a live set older than about 6 hours as stale, keeping its date', () => {
    const at = (valid: string) => ready({ source: 'live', valid: new Date(valid) });
    expect(at('2026-11-22T05:40:00Z')).toBe('clouds 22 NOV 05:40Z, detail synthesised');
    expect(at('2026-11-22T05:39:00Z')).toBe('clouds 22 NOV 05:39Z, stale, detail synthesised');
    expect(at('2026-11-21T09:00:00Z')).toBe('clouds 21 NOV 09:00Z, stale, detail synthesised');
  });

  it('never calls the static map stale', () => {
    expect(cloudReadout({ status: 'ready', set: staticMap, now: new Date('2027-01-01T00:00:00Z'), overCap: false })).toBe('clouds: static map, detail synthesised');
  });

  it('says when the view is over a cap without cloud data', () => {
    expect(ready(staticMap, true)).toBe('clouds: no polar data');
  });

  it('says nothing while the map loads, and says so when it failed', () => {
    expect(cloudReadout({ status: 'loading', set: null, now, overCap: false })).toBeNull();
    expect(cloudReadout({ status: 'failed', set: null, now, overCap: true })).toBe('clouds: unavailable');
  });
});

describe('choosing where the clouds come from', () => {
  const base = 'https://clouds.example';
  const staticUrl = '/clouds/static.json';
  const fallback = { url: staticUrl, source: 'static' };

  it('tries the latest pointer, then the static map', () => {
    expect(cloudCandidates({ base, staticUrl })).toEqual([{ url: `${base}/latest.json`, source: 'live' }, fallback]);
  });

  it('uses the static map alone when there is no live source', () => {
    expect(cloudCandidates({ base: null, staticUrl })).toEqual([fallback]);
    expect(cloudCandidates({ base: null, staticUrl, at: new Date('2026-11-22T12:30:00Z') })).toEqual([fallback]);
  });

  it('looks for a pinned moment among the sets of the 6 hours before it, newest first, dated before kept', () => {
    const urls = cloudCandidates({ base, staticUrl, at: new Date('2026-11-22T12:30:00Z') }).map((c) => c.url);
    expect(urls).toEqual([
      `${base}/dated/20261122T1200Z/meta.json`, `${base}/kept/20261122T1200Z/meta.json`,
      `${base}/dated/20261122T1100Z/meta.json`, `${base}/kept/20261122T1100Z/meta.json`,
      `${base}/dated/20261122T1000Z/meta.json`, `${base}/kept/20261122T1000Z/meta.json`,
      `${base}/dated/20261122T0900Z/meta.json`, `${base}/kept/20261122T0900Z/meta.json`,
      `${base}/dated/20261122T0800Z/meta.json`, `${base}/kept/20261122T0800Z/meta.json`,
      `${base}/dated/20261122T0700Z/meta.json`, `${base}/kept/20261122T0700Z/meta.json`,
      staticUrl,
    ]);
  });

  it('counts a set valid at the moment itself but not one exactly 6 hours before, across midnight', () => {
    const urls = cloudCandidates({ base, staticUrl, at: new Date('2026-11-23T02:00:00Z') }).map((c) => c.url);
    expect(urls[0]).toBe(`${base}/dated/20261123T0200Z/meta.json`);
    expect(urls.at(-2)).toBe(`${base}/kept/20261122T2100Z/meta.json`);
    expect(urls).not.toContain(`${base}/dated/20261122T2000Z/meta.json`);
  });
});

describe('refetching clouds when a tab comes back', () => {
  const live = { source: 'live', valid: new Date('2026-11-22T09:00:00Z') } as const;

  it('loads a set only when the pointer names a newer one', () => {
    expect(cloudsNewer(live, '2026-11-22T12:00:00.000Z')).toBe(true);
    expect(cloudsNewer(live, '2026-11-22T09:00:00.000Z')).toBe(false);
    expect(cloudsNewer(live, '2026-11-22T06:00:00.000Z')).toBe(false);
  });

  it('keeps what it has when the pointer is missing or unreadable', () => {
    expect(cloudsNewer(live, null)).toBe(false);
    expect(cloudsNewer(live, 'soon')).toBe(false);
  });

  it('replaces the static map, or no clouds at all, with any live set', () => {
    expect(cloudsNewer({ source: 'static', valid: new Date('2026-11-22T11:00:00Z') }, '2026-11-21T00:00:00.000Z')).toBe(true);
    expect(cloudsNewer(null, '2026-11-21T00:00:00.000Z')).toBe(true);
  });
});

describe('rechecking clouds while a tab stays visible', () => {
  const HOUR = 3_600_000;
  const start = Date.parse('2026-11-22T09:50:00Z');
  // The job runs every 3 hours and its set lands about 45 minutes after the satellite pass.
  const pointerAt = (now: number) => {
    const valid = Math.floor((now - 0.75 * HOUR) / (3 * HOUR)) * 3 * HOUR;
    return new Date(valid).toISOString();
  };

  it('keeps a healthy job from reading stale on a tab left open all day', () => {
    let set: CloudSetInfo = { source: 'live', valid: new Date(pointerAt(start)) };
    let lastCheck = start;
    let checks = 0;
    for (let now = start; now < start + 24 * HOUR; now += 10_000) {
      if (cloudsRecheckDue(lastCheck, now)) {
        lastCheck = now;
        checks++;
        const valid = pointerAt(now);
        if (cloudsNewer(set, valid)) set = { source: 'live', valid: new Date(valid) };
      }
      expect(cloudReadout({ status: 'ready', set, now: new Date(now), overCap: false })).not.toMatch(/stale/);
    }
    expect(checks).toBeLessThanOrEqual(48);
  });

  it("doesn't check again within minutes of the last check", () => {
    expect(cloudsRecheckDue(start, start + 60_000)).toBe(false);
    expect(cloudsRecheckDue(start, start + 10 * 60_000)).toBe(false);
  });
});
