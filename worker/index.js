// Same-origin relay so ad blockers that block posthog.com don't drop events. The prefix avoids
// words like "analytics" or "posthog" that blocklists match on.
const PREFIX = '/uplink';
const API_HOST = 'us.i.posthog.com';
const ASSET_HOST = 'us-assets.i.posthog.com';

async function relayAsset(request, path, ctx) {
  if (request.method !== 'GET') return fetch(`https://${ASSET_HOST}${path}`, { method: request.method });
  const cached = await caches.default.match(request);
  if (cached) return cached;
  const response = await fetch(`https://${ASSET_HOST}${path}`);
  if (response.ok) ctx.waitUntil(caches.default.put(request, response.clone()).catch(() => {}));
  return response;
}

async function relayApi(request, path) {
  const headers = new Headers(request.headers);
  headers.delete('cookie');
  // Only the site's public project token passes through, so the relay can't carry personal API keys.
  if (!/^Bearer phc_/.test(headers.get('authorization') ?? '')) headers.delete('authorization');
  // Cookieless IDs and geo come from this IP; an empty value would merge visitors under Cloudflare's IP.
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) headers.set('X-Forwarded-For', ip);
  else headers.delete('X-Forwarded-For');
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
