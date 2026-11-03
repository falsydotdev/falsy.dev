// Loads the live scene when the stage has decided to try it (see Stage.astro). Everything
// heavy sits behind a dynamic import, so poster-only visitors never download three.js.

declare global {
  interface Window {
    __falsyShowPoster?: () => void;
    __falsyLive?: { state: { frames: number; shot: string; backend: string; canvas: HTMLCanvasElement } };
  }
}

const DATA_URL = '/data';

// Preview-only camera overrides, clamped to sensible real-orbit ranges.
function numberParam(params: URLSearchParams, key: string, min: number, max: number) {
  const raw = params.get(key);
  if (raw === null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
}

export async function boot() {
  const params = new URLSearchParams(location.search);
  const sky = document.querySelector<HTMLElement>('#stage .sky');
  if (!sky || sky.dataset.scene !== 'pending') return;
  const fallBack = () => window.__falsyShowPoster?.();

  // Until the tile pipeline lands, the live scene needs locally linked data (`npm run data`).
  const probe = await fetch(`${DATA_URL}/meta.json`, { method: 'HEAD' }).catch(() => null);
  if (!probe?.ok) return fallBack();

  const timeScale = Math.max(1, Number(params.get('t') ?? 1) || 1);
  try {
    const { startLiveScene } = await import('./live/scene.js');
    const live = await startLiveScene(sky, {
      dataUrl: DATA_URL,
      shot: params.get('shot'),
      altKm: numberParam(params, 'alt', 120, 2000),
      tiltDeg: numberParam(params, 'tilt', -10, 60),
      fovDeg: numberParam(params, 'fov', 15, 80),
      timeScale,
      forceWebGL: params.has('webgl'),
      telemetry: document.getElementById('telemetry'),
      onFirstFrame: () => {
        sky.dataset.scene = 'live';
        sky.classList.add('is-live');
      },
    });
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
