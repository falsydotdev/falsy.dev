import type { PostHog } from 'posthog-js';

const token = import.meta.env.PUBLIC_POSTHOG_TOKEN;
const host = import.meta.env.PUBLIC_POSTHOG_HOST;

// Only the production host reports, so dev, Lighthouse CI and PR previews stay out of the data.
// `?ph=1` turns it on anywhere, for testing a build locally.
function shouldTrack() {
  if (!token || !host) return false;
  if (new URLSearchParams(location.search).get('ph') === '1') return true;
  return location.hostname === 'falsy.dev' && !navigator.webdriver;
}

// Records once per visit whether the visitor got the live orbit or a poster, and on which GPU path.
function reportScene(posthog: PostHog) {
  const sky = document.querySelector<HTMLElement>('#stage .sky');
  if (!sky) return;
  const send = () => {
    const mode = sky.dataset.scene;
    if (mode !== 'live' && mode !== 'poster') return false;
    const live = mode === 'live' ? window.__falsyLive?.state : undefined;
    const props = {
      scene: mode,
      scene_backend: live?.backend ?? null,
      scene_tier: live?.tier ?? null,
      scene_poster: document.getElementById('telemetry')?.dataset.poster ?? null,
    };
    posthog.register(props);
    posthog.capture('scene_shown', props);
    return true;
  };
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
        disable_session_recording: true,
        disable_surveys: true,
      });
      reportScene(posthog);
    });
  if (document.readyState === 'complete') start();
  else addEventListener('load', start, { once: true });
}
