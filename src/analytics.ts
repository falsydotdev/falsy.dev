import type { PostHog } from 'posthog-js';
import { frameTimes } from './scene/perf.ts';

const token = import.meta.env.PUBLIC_POSTHOG_TOKEN;
const host = import.meta.env.PUBLIC_POSTHOG_HOST;

// Long enough for the governor to settle on a tier after the fade-in.
const PERF_SAMPLE_AFTER_MS = 20_000;
const MIN_PERF_SAMPLES = 60;

// Only the production host reports, so dev, Lighthouse CI and PR previews stay out of the data.
// `?ph=1` turns it on anywhere; test locally under `wrangler dev`, which serves the /uplink relay.
function shouldTrack() {
  if (!token || !host) return false;
  if (new URLSearchParams(location.search).get('ph') === '1') return true;
  return location.hostname === 'falsy.dev' && !navigator.webdriver;
}

function sceneProps(mode: 'live' | 'poster') {
  const live = mode === 'live' ? window.__falsyLive?.state : undefined;
  return {
    scene: mode,
    scene_body: live?.body ?? document.documentElement.dataset.body ?? null,
    scene_backend: live?.backend ?? null,
    scene_tier: live?.tier ?? null,
    scene_poster: document.getElementById('telemetry')?.dataset.poster || null,
  };
}

function frameProps(state: LiveState) {
  const t = frameTimes(state.gpuLog);
  return { gpu_ms_p50: t.p50, gpu_ms_p90: t.p90, gpu_samples: t.samples, timing: state.timing };
}

// One frame-time reading per scene once its tier settles, so every visit shows its headroom.
// The scene restarts its frame log when the tab returns, and so does this clock.
function samplePerf(posthog: PostHog, sky: HTMLElement, state: LiveState) {
  let timer = 0;
  const arm = () => {
    clearTimeout(timer);
    if (state.stopped || window.__falsyLive?.state !== state) return stop();
    if (document.visibilityState === 'visible') timer = window.setTimeout(fire, PERF_SAMPLE_AFTER_MS);
  };
  // A step-down restarts the scene's frame log, so the tier has to settle again.
  const onTier = (e: Event) => (e as CustomEvent<{ state: LiveState }>).detail?.state === state && arm();
  const stop = () => {
    document.removeEventListener('visibilitychange', arm);
    document.removeEventListener('falsy:tier-changed', onTier);
  };
  const fire = () => {
    // A scene switched away from, lost to a poster, or frozen would report stale frames.
    if (window.__falsyLive?.state !== state || sky.dataset.scene !== 'live' || state.stopped || state.tier === 'frozen') return stop();
    // Mid-switch the log isn't this scene's alone; after a scroll or switch it restarts and needs refilling.
    // Any WebGPU scene fills the log, including one with a forced tier.
    const short = state.backend !== 'WebGL2' && state.gpuLog.length < MIN_PERF_SAMPLES;
    if (state.held || short || document.documentElement.classList.contains('body-fade')) return arm();
    stop();
    posthog.capture('scene_perf', {
      body: state.body,
      tier: state.tier,
      start_tier: state.startTier,
      gpu: state.gpu ?? null,
      dpr: devicePixelRatio,
      render_ratio: state.pixelRatio,
      ...frameProps(state),
    });
  };
  document.addEventListener('visibilitychange', arm);
  document.addEventListener('falsy:tier-changed', onTier);
  arm();
}

// Records once per visit whether the visitor got the live orbit or a poster, and on which GPU path,
// then each switch between bodies from the readout, each tier step-down, and one frame-time sample.
function reportScene(posthog: PostHog) {
  const sky = document.querySelector<HTMLElement>('#stage .sky');
  if (!sky) return;
  // Changes logged before analytics loaded, including from scenes already switched away or lost
  // to a poster, go out on the first flush.
  let sentChanges = 0;
  let shown = false;
  const sampled = new WeakSet<LiveState>();
  const sample = (state: LiveState) => {
    if (sampled.has(state)) return;
    sampled.add(state);
    samplePerf(posthog, sky, state);
  };
  const sendTierChanges = () => {
    if (!shown) return;
    const log = window.__falsyTierLog ?? [];
    for (const c of log.slice(sentChanges)) {
      posthog.capture('scene_tier_changed', {
        // Sent late, after register() has moved on to the current scene.
        scene: c.to === 'poster' ? 'poster' : 'live',
        scene_body: c.body,
        scene_backend: c.backend,
        scene_tier: c.to,
        body: c.body,
        from: c.from,
        to: c.to,
        at_ms: c.atMs,
        load: c.load,
        gpu_ms_p50: c.gpu.p50,
        gpu_ms_p90: c.gpu.p90,
        gpu_samples: c.gpu.samples,
        gpu: c.gpuName ?? null,
      });
    }
    sentChanges = log.length;
    // Later events should carry the tier the scene runs at now.
    if (log.length && sky.dataset.scene === 'live') posthog.register(sceneProps('live'));
  };
  // A slow live scene can arrive after the poster fallback; that visit is reported once as shown,
  // then again when it goes live, so its load timing isn't lost.
  let reported: 'live' | 'poster' | null = null;
  const send = () => {
    const mode = sky.dataset.scene;
    if ((mode !== 'live' && mode !== 'poster') || mode === reported) return mode === 'live';
    if (mode === 'poster' && reported === 'live') return true;
    const props = sceneProps(mode);
    posthog.register(props);
    const live = mode === 'live' ? window.__falsyLive?.state : undefined;
    const page = window.__falsyPageReady;
    posthog.capture(reported === 'poster' ? 'scene_went_live' : 'scene_shown', {
      ...props,
      ...(live && {
        // From the page's first scene, which may not be the one showing if the visitor already switched.
        scene_load_body: page?.body ?? null,
        scene_ready_since_nav_ms: page?.sinceNavMs ?? null,
        scene_load_render_ms: page?.renderMs ?? null,
        scene_hidden_during_load: page?.hiddenDuringLoad ?? null,
        scene_gpu: live.gpu ?? null,
        scene_dpr: devicePixelRatio,
        scene_render_ratio: live.pixelRatio,
      }),
    });
    reported = mode;
    shown = true;
    sendTierChanges();
    if (live) sample(live);
    return mode === 'live';
  };
  document.addEventListener('falsy:tier-changed', sendTierChanges);
  document.addEventListener('falsy:body-switched', (e) => {
    const { from, to, mode } = (e as CustomEvent<{ from: string; to: string; mode: 'live' | 'poster' }>).detail;
    posthog.register(sceneProps(mode));
    posthog.capture('body_switched', { from, to, mode });
    const live = mode === 'live' ? window.__falsyLive?.state : undefined;
    if (live) sample(live);
  });
  if (send()) return;
  const watch = new MutationObserver(() => send() && watch.disconnect());
  watch.observe(sky, { attributes: true, attributeFilter: ['data-scene'] });
}

export function startAnalytics() {
  if (!shouldTrack()) return;
  const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 1));
  // Wait for load and an idle moment so the SDK never competes with the hero's first frame.
  const start = () =>
    idle(async () => {
      const { default: posthog } = await import('posthog-js');
      posthog.init(token!, {
        api_host: host,
        ui_host: 'https://us.posthog.com',
        defaults: '2026-08-30',
        capture_pageview: 'history_change',
        // No cookies or storage, so no consent banner. PostHog derives a daily anonymous ID
        // server-side from IP and user agent, which is why the relay forwards the visitor's IP.
        cookieless_mode: 'always',
        disable_session_recording: true,
        disable_surveys: true,
      });
      reportScene(posthog);
    });
  if (document.readyState === 'complete') start();
  else addEventListener('load', start, { once: true });
}
