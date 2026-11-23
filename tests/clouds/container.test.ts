import { readFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error The cloud job is plain JS outside the type-checked tree.
import { handleProcess } from '../../clouds/container/handler.js';
// @ts-expect-error The cloud job is plain JS outside the type-checked tree.
import { readGmgsi } from '../../clouds/container/gmgsi.js';
// @ts-expect-error The cloud job is plain JS outside the type-checked tree.
import { processClouds } from '../../clouds/container/process.js';
// @ts-expect-error The cloud job is plain JS outside the type-checked tree.
import { readBundle, writeBundle } from '../../clouds/shared/bundle.js';

const W = 4096;
const H = 2048;
const nc = readFileSync(new URL('./fixtures/gmgsi-lw-stride16.nc', import.meta.url));
const source = { bucket: 'noaa-gmgsi-pds', key: 'GMGSI_LW/2026/11/22/11/sample.nc' };
const warm = new Uint8Array(W * H).fill(40);
const history = ['20261119', '20261120', '20261121'];

async function call(parts: { name: string; body: Uint8Array }[]) {
  const { stream } = writeBundle(parts.map((p) => ({ ...p, size: p.body.length })));
  const request = new Uint8Array(await new Response(stream).arrayBuffer());
  const out = await handleProcess(request);
  return new Map<string, Uint8Array>(readBundle(out).map((p: any) => [p.name, p.bytes]));
}

let parts: Map<string, Uint8Array>;
beforeAll(async () => {
  parts = await call([
    { name: 'request.json', body: new TextEncoder().encode(JSON.stringify({ source })) },
    { name: 'gmgsi.nc', body: nc },
    ...history.map((d) => ({ name: `history/${d}`, body: gzipSync(warm) })),
  ]);
}, 30_000);

describe('cloud container', () => {
  it('returns the texture as a 4096×2048 AVIF close to the computed opacity', async () => {
    const avif = parts.get('clouds.avif')!;
    const { data, info } = await sharp(avif).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([W, H]);
    const grid = await readGmgsi(nc);
    const { opacity } = processClouds({ grid, history: history.map((day) => ({ day, plane: warm })), source });
    let error = 0;
    for (let i = 0; i < opacity.length; i++) error += Math.abs(data[i] - opacity[i]);
    expect(error / opacity.length).toBeLessThan(3);
  });

  it("returns the metadata and today's updated clear-sky plane", () => {
    const meta = JSON.parse(new TextDecoder().decode(parts.get('meta.json')));
    expect(meta.valid).toBe('2026-11-22T11:00:00.000Z');
    expect(meta.clearSky.days).toBe(3);
    expect(meta.fallback).toBeNull();
    expect(gunzipSync(parts.get('state/20261122')!).length).toBe(W * H);
  });

  it('returns a clear-sky plane for each backfilled file', async () => {
    const backfilled = await call([
      { name: 'request.json', body: new TextEncoder().encode(JSON.stringify({ source })) },
      { name: 'gmgsi.nc', body: nc },
      { name: 'backfill/a.nc', body: nc },
    ]);
    expect([...backfilled.keys()].filter((k) => k.startsWith('state/'))).toEqual(['state/20261122']);
  });
});
