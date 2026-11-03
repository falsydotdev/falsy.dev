// Decides whether this visitor gets the live scene, then loads it. Everything heavy
// sits behind a dynamic import, so poster-only visitors never download three.js.

declare global {
  interface Window {
    __falsyLive?: { state: { frames: number; shot: string; backend: string; canvas: HTMLCanvasElement } };
  }
}

const DATA_URL = '/data';
const MIN_WIDTH = 768;

function canGoLive(params: URLSearchParams) {
  const force = params.get('live');
  if (force === '0') return false;
  if (force === '1') return true;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  if (innerWidth < MIN_WIDTH) return false;
  if ('gpu' in navigator) return true;
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

export async function boot() {
  const params = new URLSearchParams(location.search);
  const sky = document.querySelector<HTMLElement>('#stage .sky');
  if (!sky || !canGoLive(params)) return;

  // Until the tile pipeline lands, the live scene needs locally linked data (`npm run data`).
  const probe = await fetch(`${DATA_URL}/meta.json`, { method: 'HEAD' }).catch(() => null);
  if (!probe?.ok) return;

  const { startLiveScene } = await import('./live/scene.js');
  const timeScale = Math.max(1, Number(params.get('t') ?? 1) || 1);
  try {
    const live = await startLiveScene(sky, {
      dataUrl: DATA_URL,
      shot: params.get('shot'),
      timeScale,
      forceWebGL: params.has('webgl'),
      telemetry: document.getElementById('telemetry'),
      onFirstFrame: () => sky.classList.add('is-live'),
    });
    window.__falsyLive = live;
    document.addEventListener('visibilitychange', () => live.setRunning(document.visibilityState === 'visible'));
    // The background stays visible beside the content, so past the first screen it slows down instead of stopping.
    const onScroll = () => live.setThrottled(scrollY > innerHeight * 0.8);
    addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('astro:after-swap', onScroll);
  } catch (err) {
    sky.classList.remove('is-live');
    console.warn('Live scene unavailable, keeping the poster.', err);
  }
}
