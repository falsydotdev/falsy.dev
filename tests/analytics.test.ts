import { afterEach, describe, expect, it, vi } from 'vitest';

const sent: { event: string; props: Record<string, unknown> }[] = [];
vi.mock('posthog-js', () => ({
  default: {
    init: () => {},
    capture: (event: string, props: Record<string, unknown>) => sent.push({ event, props }),
    register: (props: Record<string, unknown>) => sent.push({ event: '(register)', props }),
  },
}));

// Every property the site's own events may carry. A new one has to be added here on purpose,
// after checking it can't say where the visitor is.
const ALLOWED = new Set([
  'scene', 'scene_body', 'scene_backend', 'scene_tier', 'scene_poster',
  'scene_load_body', 'scene_ready_since_nav_ms', 'scene_load_render_ms', 'scene_hidden_during_load', 'scene_gpu', 'scene_dpr', 'scene_render_ratio',
  'body', 'tier', 'start_tier', 'gpu', 'dpr', 'render_ratio', 'throttled', 'gpu_ms_p50', 'gpu_ms_p90', 'gpu_samples', 'timing',
  'from', 'to', 'at_ms', 'load', 'mode',
]);

function stubPage(search = '?ph=1') {
  const listeners = new Map<string, ((e: Event) => void)[]>();
  const on = (type: string, fn: (e: Event) => void) => listeners.set(type, [...(listeners.get(type) ?? []), fn]);
  const state = {
    frames: 900, body: 'earth', shot: 'home-pass', backend: 'WebGPU', tier: 'high', startTier: 'high', timing: 'gpu',
    gpu: 'apple', gpuLog: Array.from({ length: 120 }, (_, i) => 8 + (i % 5)), tierChanges: [], firstFrameMs: 1800,
    stopped: false, held: false, pixelRatio: 1.25, throttled: false,
  };
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('location', { search, hostname: 'localhost' });
  vi.stubGlobal('navigator', { webdriver: false });
  vi.stubGlobal('devicePixelRatio', 2);
  vi.stubGlobal('requestIdleCallback', (cb: () => void) => cb());
  vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('document', {
    readyState: 'complete',
    visibilityState: 'visible',
    documentElement: { dataset: { body: 'earth' }, classList: { contains: () => false } },
    querySelector: () => ({ dataset: { scene: 'live' } }),
    getElementById: () => ({ dataset: { poster: '', shot: 'home-pass' } }),
    addEventListener: on,
    removeEventListener: () => {},
  });
  vi.stubGlobal('__falsyLive', { state });
  vi.stubGlobal('__falsyPageReady', { body: 'earth', sinceNavMs: 900, renderMs: 700, hiddenDuringLoad: false });
  vi.stubGlobal('__falsyTierLog', [{ from: 'high', to: 'medium', atMs: 5000, load: 0.7, gpu: { p50: 9, p90: 12, samples: 60 }, body: 'earth', backend: 'WebGPU', gpuName: 'apple' }]);
  const dispatch = (type: string, detail: unknown) => listeners.get(type)?.forEach((fn) => fn({ detail } as unknown as Event));
  return { dispatch };
}

afterEach(() => {
  sent.length = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('analytics during a home pass', () => {
  it('sends only the listed scene properties, none of them a place', async () => {
    vi.useFakeTimers();
    vi.stubEnv('PUBLIC_POSTHOG_TOKEN', 'phc_test');
    vi.stubEnv('PUBLIC_POSTHOG_HOST', 'https://example.test');
    const page = stubPage();
    const { startAnalytics } = await import('../src/analytics');
    startAnalytics();
    await vi.advanceTimersByTimeAsync(25_000);
    page.dispatch('falsy:body-switched', { from: 'mars', to: 'earth', mode: 'live' });
    await vi.advanceTimersByTimeAsync(25_000);

    expect(new Set(sent.map((s) => s.event))).toEqual(new Set(['(register)', 'scene_shown', 'scene_tier_changed', 'scene_perf', 'body_switched']));
    for (const { event, props } of sent) {
      for (const [key, value] of Object.entries(props)) {
        expect(ALLOWED.has(key), `${event} sends ${key}`).toBe(true);
        expect(['string', 'number', 'boolean'].includes(typeof value) || value === null, `${event}.${key} is ${typeof value}`).toBe(true);
        if (typeof value === 'string') expect(value).not.toMatch(/\/|home/);
      }
    }
  });
});

describe('analytics in a preview session', () => {
  it.each(['?ph=1&fx=clouds', '?ph=1&bench=4'])('keeps frame-time data out of the field numbers with %s', async (search) => {
    vi.useFakeTimers();
    vi.stubEnv('PUBLIC_POSTHOG_TOKEN', 'phc_test');
    vi.stubEnv('PUBLIC_POSTHOG_HOST', 'https://example.test');
    stubPage(search);
    const { startAnalytics } = await import('../src/analytics');
    startAnalytics();
    await vi.advanceTimersByTimeAsync(50_000);

    const events = sent.map((s) => s.event);
    expect(events).toContain('scene_shown');
    expect(events).not.toContain('scene_perf');
    expect(events).not.toContain('scene_tier_changed');
  });
});
