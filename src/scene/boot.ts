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
import { type Body, BODIES, bodyById } from './bodies.ts';

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
  dispose(): void;
  freeze(): HTMLCanvasElement | null;
  surfaces(): HTMLCanvasElement[];
  setTelemetry(el: HTMLElement | null): void;
  holdGovernor(on: boolean): void;
  setRunning(on: boolean): void;
  setThrottled(on: boolean): void;
}

// Each scene's place in the page; `dead` records a lost GPU device even before the scene object exists.
interface Slot {
  scene: LiveScene | null;
  dead: boolean;
}

const FADE_MS = 1000;
// A switch fades in once the new view has its coarse tiles; fine detail streams in after, as on any load.
const SWITCH_SETTLE_MS = 2500;
const PREWARM_LEVELS = 2;
const BODY_IDS = Object.keys(BODIES);
const nextBody = (b: Body) => bodyById(BODY_IDS[(BODY_IDS.indexOf(b.id) + 1) % BODY_IDS.length]);
const throttledNow = () => scrollY > innerHeight * 0.8;

// Loads the next body's coarse tiles into the HTTP cache (they're immutable), so a switch has
// something to show almost at once.
const prewarmed = new Set<string>();
async function prewarm(body: Body) {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (prewarmed.has(body.id) || connection?.saveData) return;
  prewarmed.add(body.id);
  const { colorPath, heightPath, SHADOW_MAP } = await import('./tiles/layout.ts');
  const paths: string[] = ['meta.json', SHADOW_MAP.path];
  for (let level = 0; level <= PREWARM_LEVELS; level++) {
    const n = 2 ** level;
    for (let face = 0; face < 6; face++) {
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) paths.push(colorPath({ face, level, x, y }), heightPath({ face, level, x, y }));
    }
  }
  const queue = paths.map((p) => `${tilesUrl(body)}/${p}`);
  // Reading each body keeps six requests in flight and lets the cache entry complete.
  const fetchNext = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      await fetch(url, { priority: 'low' } as RequestInit)
        .then((r) => r.arrayBuffer())
        .catch(() => null);
    }
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

  let current: Slot | null = null;
  let incoming: Slot | null = null;
  let abortSwitch = () => {};
  const setBusy = (on: boolean) => button?.setAttribute('aria-busy', String(on));
  const lostCurrent = () => {
    current = null;
    sky.classList.remove('is-live');
    fallBack();
  };
  // A lost device ends a switch if it was the incoming scene. The scene on screen only falls back
  // to a poster when no switch is under way to replace it.
  const onLost = (slot: Slot) => () => {
    slot.dead = true;
    if (slot === incoming) abortSwitch();
    else if (slot === current && !incoming) lostCurrent();
  };

  try {
    const { startLiveScene } = await import('./live/scene.js');
    const start = (b: Body, slot: Slot, opts: Record<string, unknown>) =>
      startLiveScene(sky, { ...shared, dataUrl: tilesUrl(b), body: b.id, onLost: onLost(slot), ...opts }) as Promise<LiveScene | null>;

    const firstSlot: Slot = { scene: null, dead: false };
    current = firstSlot;
    firstSlot.scene = await start(body, firstSlot, {
      shot: params.get('shot'),
      at: at && !Number.isNaN(at.getTime()) ? at : undefined,
      seed: numberParam(params, 'seed', 0, 2 ** 32 - 1),
      feature: params.get('feature'),
      skip: numberParam(params, 'skip', 0, 3600),
      telemetry,
      onFirstFrame: () => {
        sky.dataset.scene = 'live';
        sky.classList.add('is-live');
        whenIdle(() => prewarm(nextBody(body)), 4000);
      },
    });
    if (!firstSlot.scene) return lostCurrent();
    window.__falsyLive = firstSlot.scene;
    prewarmed.add(body.id);
    // Scroll and visibility changes during loading had no scene to reach.
    firstSlot.scene.setThrottled(throttledNow());
    firstSlot.scene.setRunning(document.visibilityState === 'visible');

    // The new body loads under the old one, which keeps moving, and they crossfade at its first frame.
    // The lowest tier and WebGL2 can't carry two scenes, so they fade from the old one's frozen frame.
    const switchTo = async (id: string) => {
      const from = current;
      const old = from?.scene;
      const to = bodyById(id);
      if (incoming || !from || !old || from.dead || to.id === old.state.body) return;
      const slot: Slot = { scene: null, dead: false };
      incoming = slot;
      setBusy(true);
      const light = old.state.tier === 'low' || old.state.backend === 'WebGL2';
      const cover = light ? old.freeze() : null;
      if (!light) old.holdGovernor(true);

      let fadeTimer = 0;
      const finish = () => {
        incoming = null;
        setBusy(false);
      };
      abortSwitch = () => {
        if (incoming !== slot) return;
        slot.scene?.dispose();
        // Lost mid-fade, the new scene was already the current one, so the old can't come back.
        if (current === slot) {
          clearTimeout(fadeTimer);
          cover?.remove();
          old.dispose();
          root.classList.remove('body-fade');
          finish();
          return lostCurrent();
        }
        finish();
        if (light || from.dead) {
          cover?.remove();
          old.dispose();
          lostCurrent();
        } else old.holdGovernor(false);
      };

      const crossfade = () => {
        const next = slot.scene;
        if (incoming !== slot || !next) return;
        root.classList.add('body-fade');
        root.dataset.body = to.id;
        window.__falsyLabelSwitch?.(to.id);
        old.setTelemetry(null);
        next.setTelemetry(telemetry);
        current = slot;
        window.__falsyLive = next;
        for (const el of cover ? [cover] : old.surfaces()) {
          el.style.transition = `opacity ${FADE_MS}ms ease`;
          getComputedStyle(el).opacity;
          el.style.opacity = '0';
        }
        fadeTimer = window.setTimeout(() => {
          prewarmed.add(to.id);
          cover?.remove();
          old.dispose();
          next.holdGovernor(false);
          root.classList.remove('body-fade');
          finish();
          try {
            localStorage.setItem('falsy:body', to.id);
          } catch {}
          document.dispatchEvent(new CustomEvent('falsy:body-switched', { detail: { from: old.state.body, to: to.id, mode: 'live' } }));
          whenIdle(() => prewarm(nextBody(to)), 2000);
        }, FADE_MS + 50);
      };

      try {
        const tier = old.state.tier;
        slot.scene = await start(to, slot, {
          holdGovernor: true,
          settleTimeoutMs: SWITCH_SETTLE_MS,
          startTier: isTierName(tier) ? tier : undefined,
          onFirstFrame: crossfade,
        });
        if (!slot.scene) return abortSwitch();
        if (incoming !== slot || slot.dead) return slot.scene.dispose();
        slot.scene.setThrottled(throttledNow());
        slot.scene.setRunning(document.visibilityState === 'visible');
      } catch (err) {
        console.warn('Switching bodies failed; keeping the current one.', err);
        abortSwitch();
      }
    };
    window.__falsySwitchLive = (id: string) => void switchTo(id);

    const each = (fn: (s: LiveScene) => void) => [current, incoming].forEach((slot) => slot?.scene && fn(slot.scene));
    document.addEventListener('visibilitychange', () => each((s) => s.setRunning(document.visibilityState === 'visible')));
    // The background stays visible beside the content, so past the first screen it slows down instead of stopping.
    const onScroll = () => each((s) => s.setThrottled(throttledNow()));
    addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('astro:after-swap', onScroll);
  } catch (err) {
    lostCurrent();
    console.warn('Live scene unavailable, showing the poster.', err);
  }
}
