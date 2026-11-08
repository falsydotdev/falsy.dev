// Relays PostHog through the site's own origin, so ad blockers that block posthog.com
// don't drop visitors' events. Every other path is served straight from the static assets.
// The prefix avoids words like "analytics" or "posthog" that blocklists match on.
const PREFIX = '/uplink';
const API_HOST = 'us.i.posthog.com';
const ASSET_HOST = 'us-assets.i.posthog.com';

async function relayAsset(request, path, ctx) {
  const cached = await caches.default.match(request);
  if (cached) return cached;
  const response = await fetch(`https://${ASSET_HOST}${path}`);
  if (response.ok) ctx.waitUntil(caches.default.put(request, response.clone()));
  return response;
}

async function relayApi(request, path) {
  const headers = new Headers(request.headers);
  headers.delete('cookie');
  // Pass on PostHog's own keys only, and forward the visitor's IP so geo lookup isn't Cloudflare's.
  if (!/^Bearer ph[csx]_/.test(headers.get('authorization') ?? '')) headers.delete('authorization');
  headers.set('X-Forwarded-For', request.headers.get('CF-Connecting-IP') ?? '');
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  return fetch(`https://${API_HOST}${path}`, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : null,
    redirect: request.redirect,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(`${PREFIX}/`)) return env.ASSETS.fetch(request);
    const path = url.pathname.slice(PREFIX.length) + url.search;
    if (path.startsWith('/static/') || path.startsWith('/array/')) return relayAsset(request, path, ctx);
    return relayApi(request, path);
  },
};
