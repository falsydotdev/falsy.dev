import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error The Worker is plain JS outside the type-checked tree.
import worker from '../worker/index.js';

const cache = { match: vi.fn(), put: vi.fn() };
const assets = { fetch: vi.fn(async () => new Response('asset')) };
const ctx = { waitUntil: vi.fn() };
let upstream: ReturnType<typeof vi.fn>;

beforeEach(() => {
  upstream = vi.fn(async () => new Response('upstream'));
  vi.stubGlobal('fetch', upstream);
  vi.stubGlobal('caches', { default: cache });
  cache.match.mockResolvedValue(undefined);
  cache.put.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const run = (url: string, init?: RequestInit) => worker.fetch(new Request(`https://falsy.dev${url}`, init), { ASSETS: assets }, ctx);

describe('PostHog relay worker', () => {
  it('serves every other path from the static assets', async () => {
    await run('/projects/karstscout');
    await run('/uplinked');
    expect(assets.fetch).toHaveBeenCalledTimes(2);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('sends SDK files and remote config to the asset host and caches them', async () => {
    await run('/uplink/static/array.js?v=1');
    await run('/uplink/array/phc_x/config.js');
    expect(upstream.mock.calls.map((c) => c[0])).toEqual([
      'https://us-assets.i.posthog.com/static/array.js?v=1',
      'https://us-assets.i.posthog.com/array/phc_x/config.js',
    ]);
    expect(ctx.waitUntil).toHaveBeenCalledTimes(2);
  });

  it('does not cache asset requests that are not GET', async () => {
    await run('/uplink/static/array.js', { method: 'HEAD' });
    expect(upstream.mock.calls[0][1]).toEqual({ method: 'HEAD' });
    expect(cache.match).not.toHaveBeenCalled();
    expect(ctx.waitUntil).not.toHaveBeenCalled();
  });

  it('forwards events to the API host with the visitor IP and without cookies', async () => {
    await run('/uplink/e/?ip=0', {
      method: 'POST',
      body: 'batch',
      headers: { cookie: 'a=b', 'CF-Connecting-IP': '203.0.113.7', authorization: 'Bearer phc_token' },
    });
    const [url, init] = upstream.mock.calls[0];
    expect(url).toBe('https://us.i.posthog.com/e/?ip=0');
    expect(init.method).toBe('POST');
    expect(new TextDecoder().decode(init.body)).toBe('batch');
    expect(init.headers.get('cookie')).toBeNull();
    expect(init.headers.get('X-Forwarded-For')).toBe('203.0.113.7');
    expect(init.headers.get('authorization')).toBe('Bearer phc_token');
  });

  it('drops credentials other than the project token, and never sends an empty forwarded IP', async () => {
    await run('/uplink/flags/', { method: 'POST', body: '{}', headers: { authorization: 'Bearer phx_personal', 'X-Forwarded-For': '' } });
    const init = upstream.mock.calls[0][1];
    expect(init.headers.get('authorization')).toBeNull();
    expect(init.headers.get('X-Forwarded-For')).toBeNull();
  });
});
