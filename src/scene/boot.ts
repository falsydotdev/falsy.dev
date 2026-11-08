// Loads the live scene when the stage has decided to try it (see Stage.astro). Everything
// heavy sits behind a dynamic import, so poster-only visitors never download three.js.

declare global {
  interface Window {
    __falsyShowPoster?: () => void;
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

export async function boot() {
  const params = new URLSearchParams(location.search);
  const sky = document.querySelector<HTMLElement>('#stage .sky');
  if (!sky || sky.dataset.scene !== 'pending') return;
  const fallBack = () => window.__falsyShowPoster?.();
  const body = bodyById(params.get('body') ?? document.documentElement.dataset.body);
  const dataUrl = tilesUrl(body);

  const probe = await fetch(`${dataUrl}/meta.json`, { method: 'HEAD' }).catch(() => null);
  if (!probe?.ok) return fallBack();

  const tParam = Number(params.get('t') ?? 1);
  const timeScale = Number.isFinite(tParam) ? Math.max(0, tParam) : 1;
  const at = params.has('at') ? new Date(params.get('at') ?? '') : undefined;
  const tierParam = params.get('tier');
  try {
    const { startLiveScene } = await import('./live/scene.js');
    const live = await startLiveScene(sky, {
      dataUrl,
      body: body.id,
      shot: params.get('shot'),
      altKm: numberParam(params, 'alt', 120, 2000),
      tiltDeg: numberParam(params, 'tilt', -10, 60),
      rollDeg: numberParam(params, 'roll', -45, 45),
      fovDeg: numberParam(params, 'fov', 15, 80),
      farKm: numberParam(params, 'far', 0, 5000),
      tier: isTierName(tierParam) ? tierParam : undefined,
      at: at && !Number.isNaN(at.getTime()) ? at : undefined,
      seed: numberParam(params, 'seed', 0, 2 ** 32 - 1),
      feature: params.get('feature'),
      scale: numberParam(params, 'scale', 0.5, 3),
      skip: numberParam(params, 'skip', 0, 3600),
      timeScale,
      forceWebGL: params.has('webgl'),
      telemetry: document.getElementById('telemetry'),
      layout: measureLayout,
      onLost: () => {
        sky.classList.remove('is-live');
        fallBack();
      },
      onFirstFrame: () => {
        sky.dataset.scene = 'live';
        sky.classList.add('is-live');
      },
    });
    if (!live) return fallBack();
    window.__falsyLive = live;
    document.addEventListener('visibilitychange', () => live.setRunning(document.visibilityState === 'visible'));
    // The background stays visible beside the content, so past the first screen it slows down instead of stopping.
    const onScroll = () => live.setThrottled(scrollY > innerHeight * 0.8);
    addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('astro:after-swap', onScroll);
  } catch (err) {
    sky.classList.remove('is-live');
    fallBack();
    console.warn('Live scene unavailable, showing the poster.', err);
  }
}
