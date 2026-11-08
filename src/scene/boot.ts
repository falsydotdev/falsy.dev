// Loads the live scene when the stage has decided to try it (see Stage.astro). Everything
// heavy sits behind a dynamic import, so poster-only visitors never download three.js.

declare global {
  interface Window {
    __falsyShowPoster?: () => void;
    __falsySwitchLive?: (body: string) => void;
    __falsyLabelSwitch?: (body: string) => void;
    __falsyLive?: { state: { frames: number; body: string; shot: string; backend: string; tier: string; canvas: HTMLCanvasElement } };
  }
}

import { isTierName } from './quality.ts';
import { type Body, bodyById } from './bodies.ts';

// In development the dev server serves locally baked tiles at /data/<body>; production builds use R2.
const tilesUrl = (body: Body) => {
  const base = import.meta.env.PUBLIC_TILES_BASE;
  return base ? `${base}/${body.id}/${body.tiles.version}` : `/data/${body.id}`;
};

// Preview-only camera overrides, clamped to sensible real-orbit ranges.
function numberParam(params: URLSearchParams, key: string, min: number, max: number) {
  const raw = params.get(key);
  if (raw === null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
}

// The hero text and header the camera frames the planet around, as viewport fractions.
function measureLayout() {
  const parts = [...document.querySelectorAll('.hero > :not(.scroll-cue)')].map((el) => el.getBoundingClientRect());
  const header = document.querySelector('[data-header]')?.getBoundingClientRect();
  if (parts.length === 0 || !header) return null;
  const w = innerWidth;
  const h = innerHeight;
  return {
    text: {
      left: Math.min(...parts.map((r) => r.left)) / w,
      right: Math.max(...parts.map((r) => r.right)) / w,
      top: (Math.min(...parts.map((r) => r.top)) + scrollY) / h,
      bottom: (Math.max(...parts.map((r) => r.bottom)) + scrollY) / h,
    },
    headerBottom: header.bottom / h,
  };
}

interface LiveScene {
  state: { frames: number; body: string; shot: string; backend: string; tier: string; canvas: HTMLCanvasElement };
  canvas: HTMLCanvasElement;
  dispose(): void;
  freeze(): HTMLCanvasElement | null;
  setTelemetry(el: HTMLElement | null): void;
  holdGovernor(on: boolean): void;
  setRunning(on: boolean): void;
  setThrottled(on: boolean): void;
}

const FADE_MS = 1000;
// A switch fades in once the new view has its coarse tiles; fine detail streams in after, as on any load.
const SWITCH_SETTLE_MS = 2500;
const PREWARM_LEVELS = 2;

// Loads the other body's coarse tiles into the HTTP cache (they're immutable), so a switch has
// something to show almost at once.
const prewarmed = new Set<string>();
async function prewarm(body: Body) {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (prewarmed.has(body.id) || connection?.saveData) return;
  prewarmed.add(body.id);
  const { colorPath, heightPath } = await import('./tiles/layout.ts');
  const paths = ['meta.json', 'shadow-heights.bin'];
  for (let level = 0; level <= PREWARM_LEVELS; level++) {
    const n = 2 ** level;
    for (let face = 0; face < 6; face++) {
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) paths.push(colorPath({ face, level, x, y }), heightPath({ face, level, x, y }));
    }
  }
  const queue = paths.map((p) => `${tilesUrl(body)}/${p}`);
  const fetchNext = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) await fetch(url, { priority: 'low' } as RequestInit).catch(() => null);
  };
  await Promise.all(Array.from({ length: 6 }, fetchNext));
}

const whenIdle = (fn: () => void, delayMs: number) =>
  setTimeout(() => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 5000 }) : fn()), delayMs);

export async function boot() {
  const params = new URLSearchParams(location.search);
  const sky = document.querySelector<HTMLElement>('#stage .sky');
  if (!sky || sky.dataset.scene !== 'pending') return;
  const root = document.documentElement;
  const telemetry = document.getElementById('telemetry');
  const button = telemetry?.querySelector<HTMLButtonElement>('.body-switch') ?? null;
  const fallBack = () => window.__falsyShowPoster?.();
  const body = bodyById(params.get('body') ?? root.dataset.body);

  const probe = await fetch(`${tilesUrl(body)}/meta.json`, { method: 'HEAD' }).catch(() => null);
  if (!probe?.ok) return fallBack();

  const tParam = Number(params.get('t') ?? 1);
  const at = params.has('at') ? new Date(params.get('at') ?? '') : undefined;
  const tierParam = params.get('tier');
  // Preview overrides that hold for any body. Shot, feature, time, seed, and skip pick the first view only.
  const shared = {
    altKm: numberParam(params, 'alt', 120, 2000),
    tiltDeg: numberParam(params, 'tilt', -10, 60),
    rollDeg: numberParam(params, 'roll', -45, 45),
    fovDeg: numberParam(params, 'fov', 15, 80),
    farKm: numberParam(params, 'far', 0, 5000),
    tier: isTierName(tierParam) ? tierParam : undefined,
    scale: numberParam(params, 'scale', 0.5, 3),
    timeScale: Number.isFinite(tParam) ? Math.max(0, tParam) : 1,
    forceWebGL: params.has('webgl'),
    layout: measureLayout,
  };

  let current: LiveScene | null = null;
  let switching = false;
  const other = (b: Body) => bodyById(b.id === 'mars' ? 'moon' : 'mars');
  const setBusy = (on: boolean) => button?.setAttribute('aria-busy', String(on));
  const lostCurrent = () => {
    current = null;
    sky.classList.remove('is-live');
    fallBack();
  };

  try {
    const { startLiveScene } = await import('./live/scene.js');
    const start = (b: Body, opts: Record<string, unknown>) =>
      startLiveScene(sky, { ...shared, dataUrl: tilesUrl(b), body: b.id, ...opts }) as Promise<LiveScene | null>;

    const first = await start(body, {
      shot: params.get('shot'),
      at: at && !Number.isNaN(at.getTime()) ? at : undefined,
      seed: numberParam(params, 'seed', 0, 2 ** 32 - 1),
      feature: params.get('feature'),
      skip: numberParam(params, 'skip', 0, 3600),
      telemetry,
      // During a switch the incoming scene takes over, so losing this one isn't a fallback.
      onLost: () => !switching && lostCurrent(),
      onFirstFrame: () => {
        sky.dataset.scene = 'live';
        sky.classList.add('is-live');
        whenIdle(() => prewarm(other(body)), 4000);
      },
    });
    if (!first) return fallBack();
    current = first;
    window.__falsyLive = first;

    // The new body loads under the one on screen, which keeps moving; once the new view has a
    // frame, the old one fades out and is disposed. On the lowest tier or WebGL2 a machine can't
    // carry two scenes, so the old one freezes on its last frame and the switch fades from that.
    const switchTo = async (id: string) => {
      const from = current;
      const to = bodyById(id);
      if (switching || !from || to.id === from.state.body) return;
      switching = true;
      setBusy(true);
      const light = from.state.tier === 'low' || from.state.backend === 'WebGL2';
      const cover = light ? from.freeze() : null;
      if (!light) from.holdGovernor(true);

      let next: LiveScene | null = null;
      const abort = () => {
        next?.dispose();
        switching = false;
        setBusy(false);
        if (!light) return from.holdGovernor(false);
        cover?.remove();
        lostCurrent();
      };

      const crossfade = () => {
        if (!next || current !== from) return;
        const shown = next;
        root.classList.add('body-fade');
        root.dataset.body = to.id;
        window.__falsyLabelSwitch?.(to.id);
        from.setTelemetry(null);
        shown.setTelemetry(telemetry);
        current = shown;
        window.__falsyLive = shown;
        const fading = cover ?? from.canvas;
        fading.style.transition = `opacity ${FADE_MS}ms ease`;
        getComputedStyle(fading).opacity;
        fading.style.opacity = '0';
        setTimeout(() => {
          if (cover) cover.remove();
          else from.dispose();
          shown.holdGovernor(false);
          root.classList.remove('body-fade');
          switching = false;
          setBusy(false);
          try {
            localStorage.setItem('falsy:body', to.id);
          } catch {}
          document.dispatchEvent(new CustomEvent('falsy:body-switched', { detail: { from: from.state.body, to: to.id, mode: 'live' } }));
          whenIdle(() => prewarm(other(to)), 2000);
        }, FADE_MS + 50);
      };

      try {
        next = await start(to, {
          holdGovernor: true,
          settleTimeoutMs: SWITCH_SETTLE_MS,
          onLost: () => (current === next ? lostCurrent() : abort()),
          onFirstFrame: crossfade,
        });
        if (!next) abort();
      } catch (err) {
        console.warn('Switching bodies failed; keeping the current one.', err);
        abort();
      }
    };
    window.__falsySwitchLive = (id: string) => void switchTo(id);

    document.addEventListener('visibilitychange', () => current?.setRunning(document.visibilityState === 'visible'));
    // The background stays visible beside the content, so past the first screen it slows down instead of stopping.
    const onScroll = () => current?.setThrottled(scrollY > innerHeight * 0.8);
    addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('astro:after-swap', onScroll);
  } catch (err) {
    sky.classList.remove('is-live');
    fallBack();
    console.warn('Live scene unavailable, showing the poster.', err);
  }
}
