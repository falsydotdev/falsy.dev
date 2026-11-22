import { beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error The cloud job is plain JS outside the type-checked tree.
import { runJob } from '../../clouds/worker/job.js';
// @ts-expect-error The cloud job is plain JS outside the type-checked tree.
import { readBundle, writeBundle } from '../../clouds/shared/bundle.js';

const NOAA = 'https://noaa-gmgsi-pds.s3.amazonaws.com';
const keyFor = (iso: string) => {
  const d = iso.replace(/[-:T]/g, '').slice(0, 10);
  return `GMGSI_LW/${d.slice(0, 4)}/${d.slice(4, 6)}/${d.slice(6, 8)}/${d.slice(8, 10)}/GLOBCOMPLIR_v3r0_blend_s${d}00000_e${d}09599_c${d}33565.nc`;
};

type Stored = { bytes: Uint8Array; options?: any };

function fakeBucket(initial: Record<string, string | Uint8Array> = {}) {
  const objects = new Map<string, Stored>();
  for (const [k, v] of Object.entries(initial)) {
    objects.set(k, { bytes: typeof v === 'string' ? new TextEncoder().encode(v) : v });
  }
  const puts: string[] = [];
  const object = (key: string) => {
    const o = objects.get(key)!;
    return {
      key,
      size: o.bytes.length,
      httpMetadata: o.options?.httpMetadata,
      get body() {
        return new Response(o.bytes).body;
      },
      arrayBuffer: async () => o.bytes.slice().buffer,
      text: async () => new TextDecoder().decode(o.bytes),
      json: async () => JSON.parse(new TextDecoder().decode(o.bytes)),
    };
  };
  return {
    objects,
    puts,
    json: (key: string) => JSON.parse(new TextDecoder().decode(objects.get(key)!.bytes)),
    async get(key: string) {
      return objects.has(key) ? object(key) : null;
    },
    async head(key: string) {
      return objects.has(key) ? { key, size: objects.get(key)!.bytes.length } : null;
    },
    async put(key: string, value: any, options?: any) {
      const bytes =
        typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(await new Response(value).arrayBuffer());
      objects.set(key, { bytes, options });
      puts.push(key);
    },
    async list({ prefix = '', delimiter }: { prefix?: string; delimiter?: string }) {
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
      if (!delimiter) return { objects: keys.map((key) => ({ key, size: objects.get(key)!.bytes.length })), delimitedPrefixes: [], truncated: false };
      const prefixes = new Set<string>();
      const direct = [];
      for (const k of keys) {
        const rest = k.slice(prefix.length);
        const i = rest.indexOf(delimiter);
        if (i >= 0) prefixes.add(prefix + rest.slice(0, i + 1));
        else direct.push({ key: k });
      }
      return { objects: direct, delimitedPrefixes: [...prefixes], truncated: false };
    },
  };
}

const connections = { open: 0, max: 0 };

function fakeNoaa(available: string[]) {
  const keys = available.map(keyFor);
  const bodyOf = (key: string) => new TextEncoder().encode(`nc:${key}`);
  return vi.fn(async (url: string) => {
    const u = new URL(url);
    if (u.searchParams.get('list-type') === '2') {
      const prefix = u.searchParams.get('prefix')!;
      const hits = keys.filter((k) => k.startsWith(prefix));
      const contents = hits.map((k) => `<Contents><Key>${k}</Key><Size>${bodyOf(k).length}</Size></Contents>`);
      return new Response(`<ListBucketResult>${contents.join('')}</ListBucketResult>`);
    }
    const key = decodeURIComponent(u.pathname.slice(1));
    if (!keys.includes(key)) return new Response('missing', { status: 404 });
    const body = bodyOf(key);
    connections.open++;
    connections.max = Math.max(connections.max, connections.open);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(body);
        controller.close();
      },
    }).pipeThrough(
      new TransformStream({
        flush() {
          connections.open--;
        },
      }),
    );
    return new Response(stream, { headers: { 'content-length': String(body.length) } });
  });
}

function fakeContainer(meta: Record<string, unknown> = {}) {
  const requests: { names: string[]; request: any }[] = [];
  return {
    requests,
    fetch: vi.fn(async (_url: string, init: any) => {
      const parts = readBundle(new Uint8Array(await new Response(init.body).arrayBuffer()));
      const request = JSON.parse(new TextDecoder().decode(parts.find((p: any) => p.name === 'request.json').bytes));
      requests.push({ names: parts.map((p: any) => p.name), request });
      const days = parts
        .filter((p: any) => p.name.startsWith('backfill/'))
        .map((p: any) => p.name.slice('backfill/'.length));
      const valid = new Date(request.valid);
      const today = request.valid.slice(0, 10).replaceAll('-', '');
      const out = [
        { name: 'clouds.avif', body: new Uint8Array([1, 2, 3]) },
        { name: 'meta.json', body: new TextEncoder().encode(JSON.stringify({ valid: valid.toISOString(), texture: { width: 4096, height: 2048 }, fallback: null, ...meta })) },
        ...[today, ...days].map((d: string) => ({ name: `state/${d}`, body: new Uint8Array([9]) })),
      ];
      const { stream } = writeBundle(out.map((p) => ({ ...p, size: p.body.length })));
      return new Response(stream);
    }),
  };
}

const quietLog = () => ({ info: vi.fn(), error: vi.fn() });
const at = (iso: string) => new Date(iso);
const previous = {
  valid: '2026-11-22T06:00:00.000Z',
  path: 'dated/20261122T0600Z/clouds.avif',
  fallback: null,
};
const fullHistory = Object.fromEntries(
  Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 10, 21 - i));
    return [`state/09/${d.toISOString().slice(0, 10).replaceAll('-', '')}`, new Uint8Array([7])];
  }),
);

let log: ReturnType<typeof quietLog>;
beforeEach(() => {
  log = quietLog();
});

describe('cloud job', () => {
  it('writes the dated texture and metadata, then latest.json last', async () => {
    const bucket = fakeBucket({ 'latest.json': JSON.stringify(previous), ...fullHistory });
    const container = fakeContainer();
    await runJob({ bucket, fetch: fakeNoaa(['2026-11-22T09:00Z']), container, now: at('2026-11-22T09:45Z'), log });

    expect(bucket.puts.at(-1)).toBe('latest.json');
    expect(bucket.puts).toEqual(expect.arrayContaining(['dated/20261122T0900Z/clouds.avif', 'dated/20261122T0900Z/meta.json', 'state/09/20261122']));
    const latest = bucket.json('latest.json');
    expect(latest).toMatchObject({
      valid: '2026-11-22T09:00:00.000Z',
      path: 'dated/20261122T0900Z/clouds.avif',
      texture: { width: 4096, height: 2048 },
      fallback: null,
      stale: false,
    });
    expect(bucket.objects.get('dated/20261122T0900Z/clouds.avif')!.options.httpMetadata).toMatchObject({
      contentType: 'image/avif',
      cacheControl: 'public, max-age=31536000, immutable',
    });
    expect(bucket.objects.get('latest.json')!.options.httpMetadata.cacheControl).toMatch(/max-age=\d{2,3}\b/);
    expect(container.requests[0].names).toEqual(expect.arrayContaining(['gmgsi.nc', 'history/20261121']));
    expect(log.error).not.toHaveBeenCalled();
  });

  it('keeps the last good set when the newest GMGSI file is missing', async () => {
    const bucket = fakeBucket({ 'latest.json': JSON.stringify(previous) });
    const container = fakeContainer();
    await runJob({ bucket, fetch: fakeNoaa([]), container, now: at('2026-11-22T09:45Z'), log });

    expect(container.fetch).not.toHaveBeenCalled();
    expect(bucket.puts).toEqual(['latest.json']);
    expect(bucket.json('latest.json')).toMatchObject({ path: previous.path, fallback: 'source-missing', checked: '2026-11-22T09:45:00.000Z' });
  });

  it('keeps the last good set when the newest GMGSI file is more than 6 hours old', async () => {
    const bucket = fakeBucket({ 'latest.json': JSON.stringify(previous) });
    const container = fakeContainer();
    await runJob({ bucket, fetch: fakeNoaa(['2026-11-22T03:00Z']), container, now: at('2026-11-22T09:45Z'), log });

    expect(container.fetch).not.toHaveBeenCalled();
    expect(bucket.json('latest.json')).toMatchObject({ path: previous.path, fallback: 'source-stale' });
  });

  it('keeps the last good set when processing fails', async () => {
    const bucket = fakeBucket({ 'latest.json': JSON.stringify(previous), ...fullHistory });
    const container = { fetch: vi.fn(async () => new Response('boom', { status: 500 })) };
    await runJob({ bucket, fetch: fakeNoaa(['2026-11-22T09:00Z']), container, now: at('2026-11-22T09:45Z'), log });

    expect(bucket.puts).toEqual(['latest.json']);
    expect(bucket.json('latest.json')).toMatchObject({ path: previous.path, fallback: 'process-failed' });
  });

  it('does not move latest.json to a set whose clear-sky history is still warming up', async () => {
    const bucket = fakeBucket({ 'latest.json': JSON.stringify(previous) });
    const container = fakeContainer({ fallback: 'warming-up' });
    await runJob({ bucket, fetch: fakeNoaa(['2026-11-22T09:00Z']), container, now: at('2026-11-22T09:45Z'), log });

    expect(bucket.objects.has('dated/20261122T0900Z/clouds.avif')).toBe(true);
    expect(bucket.json('latest.json')).toMatchObject({ path: previous.path, fallback: 'warming-up' });
  });

  it('skips a file it has already processed', async () => {
    const bucket = fakeBucket({
      'latest.json': JSON.stringify({ ...previous, valid: '2026-11-22T09:00:00.000Z', path: 'dated/20261122T0900Z/clouds.avif' }),
      'dated/20261122T0900Z/meta.json': '{}',
    });
    const container = fakeContainer();
    await runJob({ bucket, fetch: fakeNoaa(['2026-11-22T09:00Z']), container, now: at('2026-11-22T10:15Z'), log });

    expect(container.fetch).not.toHaveBeenCalled();
    expect(bucket.json('latest.json')).toMatchObject({ path: 'dated/20261122T0900Z/clouds.avif', fallback: null, stale: false });
  });

  it('backfills missing clear-sky days from older GMGSI files at the same hour', async () => {
    const bucket = fakeBucket({ 'latest.json': JSON.stringify(previous) });
    const container = fakeContainer();
    const older = ['2026-11-21T09:00Z', '2026-11-20T09:00Z', '2026-11-19T09:00Z', '2026-11-18T09:00Z', '2026-11-17T09:00Z'];
    await runJob({ bucket, fetch: fakeNoaa(['2026-11-22T09:00Z', ...older]), container, now: at('2026-11-22T09:45Z'), log });

    const backfill = container.requests[0].names.filter((n) => n.startsWith('backfill/'));
    expect(backfill).toEqual(['backfill/20261121', 'backfill/20261120', 'backfill/20261119', 'backfill/20261118']);
    expect(bucket.objects.has('state/09/20261118')).toBe(true);
  });

  it('opens each download only when the container reads it, within the Worker connection limit', async () => {
    connections.max = 0;
    const bucket = fakeBucket({ 'latest.json': JSON.stringify(previous) });
    const older = ['2026-11-21T09:00Z', '2026-11-20T09:00Z', '2026-11-19T09:00Z', '2026-11-18T09:00Z'];
    await runJob({ bucket, fetch: fakeNoaa(['2026-11-22T09:00Z', ...older]), container: fakeContainer(), now: at('2026-11-22T09:45Z'), log });
    expect(connections.max).toBe(1);
  });

  it('alerts when the newest clouds are more than 6 hours old, and not otherwise', async () => {
    const stale = fakeBucket({ 'latest.json': JSON.stringify(previous) });
    const result = await runJob({ bucket: stale, fetch: fakeNoaa([]), container: fakeContainer(), now: at('2026-11-22T12:45Z'), log });
    expect(result.alert).toBe(true);
    expect(log.error).toHaveBeenCalledWith(expect.stringMatching(/stale/));
    expect(stale.json('latest.json').stale).toBe(true);

    const fresh = quietLog();
    const ok = fakeBucket({ 'latest.json': JSON.stringify(previous) });
    const okResult = await runJob({ bucket: ok, fetch: fakeNoaa([]), container: fakeContainer(), now: at('2026-11-22T09:45Z'), log: fresh });
    expect(okResult.alert).toBe(false);
    expect(fresh.error).not.toHaveBeenCalled();
  });

  it('copies the set shown at each pinned poster moment to kept/, once', async () => {
    const bucket = fakeBucket({
      'latest.json': JSON.stringify(previous),
      'dated/20261121T0300Z/clouds.avif': new Uint8Array([3]),
      'dated/20261121T0300Z/meta.json': '{"valid":"2026-11-21T03:00:00.000Z"}',
      'dated/20261121T0600Z/clouds.avif': new Uint8Array([6]),
      'dated/20261121T0600Z/meta.json': '{"valid":"2026-11-21T06:00:00.000Z"}',
    });
    const keep = ['2026-11-21T05:30:00Z', '2026-11-25T00:00:00Z'];
    await runJob({ bucket, fetch: fakeNoaa([]), container: fakeContainer(), now: at('2026-11-22T09:45Z'), log, keep });

    expect(bucket.objects.get('kept/20261121T0300Z/clouds.avif')!.bytes).toEqual(new Uint8Array([3]));
    expect(bucket.objects.has('kept/20261121T0300Z/meta.json')).toBe(true);
    expect(bucket.objects.has('kept/20261121T0600Z/clouds.avif')).toBe(false);
    expect(bucket.json('kept/index.json')).toEqual({ '2026-11-21T05:30:00.000Z': '20261121T0300Z' });

    bucket.puts.length = 0;
    await runJob({ bucket, fetch: fakeNoaa([]), container: fakeContainer(), now: at('2026-11-22T10:45Z'), log, keep });
    expect(bucket.puts.filter((k) => k.startsWith('kept/'))).toEqual([]);
  });

  it('never logs account identifiers', async () => {
    const bucket = fakeBucket({ 'latest.json': JSON.stringify(previous), ...fullHistory });
    const id = '0123456789abcdef0123456789abcdef';
    const container = { fetch: vi.fn(async () => new Response(`failed for account ${id}`, { status: 500 })) };
    await runJob({ bucket, fetch: fakeNoaa(['2026-11-22T09:00Z']), container, now: at('2026-11-22T09:45Z'), log });

    const lines = [...log.info.mock.calls, ...log.error.mock.calls].flat().join('\n');
    expect(lines).toMatch(/process/);
    expect(lines).not.toContain(id);
  });
});

describe('poster moments', () => {
  it('pins the frame moment of every Earth poster shot', async () => {
    // @ts-expect-error The cloud job is plain JS outside the type-checked tree.
    const { posterMoments } = await import('../../clouds/worker/keep.js');
    const shots = [
      { id: 'mars-a', query: 'body=mars&at=2026-11-03T20:24:00Z&skip=100' },
      { id: 'earth-a', query: 'body=earth&shot=sunrise&at=2026-11-21T05:00:00Z&skip=90' },
      { id: 'earth-b', query: 'body=earth&feature=x' },
    ];
    expect(posterMoments(shots)).toEqual(['2026-11-21T05:01:30.000Z']);
  });
});
