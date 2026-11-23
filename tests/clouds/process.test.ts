import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error The cloud job is plain JS outside the type-checked tree.
import { readGmgsi } from '../../clouds/container/gmgsi.js';
// @ts-expect-error The cloud job is plain JS outside the type-checked tree.
import { processClouds } from '../../clouds/container/process.js';

const W = 4096;
const H = 2048;
const source = { bucket: 'noaa-gmgsi-pds', key: 'GMGSI_LW/2026/11/22/11/sample.nc' };
const rowOf = (lat: number) => Math.floor(((90 - lat) / 180) * H);
const fill = (value: number) => new Uint8Array(W * H).fill(value);
const day = (d: string, plane: Uint8Array) => ({ day: d, plane });
const maxOf = (a: Uint8Array) => a.reduce((m, v) => (v > m ? v : m), 0);
const same = (a: Uint8Array, b: Uint8Array) => Buffer.compare(a, b) === 0;
let grid: any;

beforeAll(async () => {
  grid = await readGmgsi(readFileSync(new URL('./fixtures/gmgsi-lw-stride16.nc', import.meta.url)));
});

describe('cloud processing', () => {
  it('makes a 4096×2048 opacity texture with no clouds poleward of the data', () => {
    const { opacity, meta } = processClouds({ grid, history: [day('20261121', fill(30))], source });
    expect(opacity.length).toBe(W * H);
    const row = (lat: number) => opacity.subarray(rowOf(lat) * W, (rowOf(lat) + 1) * W);
    expect(row(80).every((v: number) => v === 0)).toBe(true);
    expect(row(-80).every((v: number) => v === 0)).toBe(true);
    expect(Math.max(...row(10))).toBeGreaterThan(0);
    expect(meta.polar.north).toBeCloseTo(72.7, 1);
    expect(meta.polar.south).toBeLessThan(-72.5);
    expect(meta.polar.south).toBeGreaterThan(-72.8);
  });

  it('raises opacity with colder counts against the clear-sky reference', () => {
    const { opacity, state } = processClouds({ grid, history: [day('20261121', fill(40))], source });
    const observed = state.plane;
    const byCount = new Map<number, Set<number>>();
    for (let i = 0; i < observed.length; i++) {
      if (!observed[i]) continue;
      if (!byCount.has(observed[i])) byCount.set(observed[i], new Set());
      byCount.get(observed[i])!.add(opacity[i]);
    }
    const counts = [...byCount.keys()].sort((a, b) => a - b);
    let previous = -1;
    for (const c of counts) {
      const values = [...byCount.get(c)!];
      expect(values).toHaveLength(1);
      expect(values[0]).toBeGreaterThanOrEqual(previous);
      previous = values[0];
    }
    expect(byCount.get(45)).toEqual(new Set([0]));
    expect(byCount.get(190)).toEqual(new Set([255]));
  });

  it('takes the warmest count over the history as clear sky', () => {
    const first = processClouds({ grid, history: [], source });
    const identical = processClouds({ grid, history: [day('20261121', first.state.plane)], source });
    expect(maxOf(identical.opacity)).toBe(0);

    const warmer = first.state.plane.map((v: number) => (v ? Math.max(1, v - 40) : 0));
    const ten = Array.from({ length: 10 }, (_, i) => day(`202611${String(11 + i).padStart(2, '0')}`, warmer));
    const cloudy = processClouds({ grid, history: [...ten, day('20261120', fill(250))], source });
    expect(maxOf(cloudy.opacity)).toBeGreaterThan(0);
  });

  it('ignores missing observations and history outside the 14-day window', () => {
    const none = processClouds({ grid, history: [], source });
    const withGaps = processClouds({
      grid,
      history: [day('20261121', fill(0)), day('20261101', fill(1))],
      source,
    });
    expect(same(withGaps.opacity, none.opacity)).toBe(true);
  });

  it("merges today's earlier observation into the stored plane, keeping the warmest", () => {
    const first = processClouds({ grid, history: [], source });
    const earlierToday = first.state.plane.map((v: number) => (v > 100 ? 60 : v));
    const { state } = processClouds({ grid, history: [day('20261122', earlierToday)], source });
    expect(state.day).toBe('20261122');
    const warmest = (a: number, b: number) => (a && b ? Math.min(a, b) : a || b);
    const expected = first.state.plane.map((v: number, i: number) => warmest(v, earlierToday[i]));
    expect(same(state.plane, expected)).toBe(true);
    const again = processClouds({ grid, history: [day('20261122', state.plane)], source });
    expect(same(again.state.plane, state.plane)).toBe(true);
  });

  it('records the valid time, the source, and whether clear sky is still warming up', () => {
    const short = processClouds({ grid, history: [day('20261121', fill(40))], source });
    expect(short.meta.valid).toBe('2026-11-22T11:00:00.000Z');
    expect(short.meta.source).toMatchObject({ bucket: 'noaa-gmgsi-pds', key: source.key });
    expect(short.meta.clearSky.days).toBe(1);
    expect(short.meta.fallback).toBe('warming-up');

    const full = processClouds({
      grid,
      history: ['20261119', '20261120', '20261121'].map((d) => day(d, fill(40))),
      source,
    });
    expect(full.meta.clearSky.days).toBe(3);
    expect(full.meta.fallback).toBeNull();
  });
});
