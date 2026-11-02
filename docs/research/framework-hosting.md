# Framework and hosting research (2026-11-02)

## Recommendation

Use Astro, hosted on Cloudflare (Workers static assets), with the heavy 3D assets in R2.

- **Astro:** ships zero JS on content pages. Content collections and MDX cover projects and the blog. Mount the WebGPU canvas once, in a fixed-position persisted island in the shared layout.
  - Astro's docs say bundled module scripts run once, and `transition:persist` keeps an element or island alive across navigation.
  - The docs don't cover WebGPU canvases. Spike this early.
- **Fallback:** SvelteKit with the canvas in the root `+layout`. Layouts persist by design, and the JS cost is small. Next.js also works, but it ships the React runtime on every content page.
- **Vercel Pro:** defaults to Flat Rate CDN (1 TB and 1M requests included). Its docs exclude "bulk file distribution" and media-heavy bandwidth, and Vercel may move such projects to Flex CDN or limit them. Tens of MB of textures per visitor is that workload.
- **R2:** zero egress fees (verified). Serve it through a custom domain, because `r2.dev` is rate-limited and has no caching.
- **Same origin:** a Vercel site with R2 on `assets.falsy.dev` works, but adds CORS and COEP friction. Hosting both on Cloudflare, with an R2 binding on the same origin, removes it.

## Framework comparison

| | Persistent canvas | JS on content pages | Content/MDX | Notes |
|---|---|---|---|---|
| Astro | `transition:persist` plus `<ClientRouter />` | None by default | Content collections, MDX | Best fit for mostly static content |
| Next.js App Router | Root layout persists (unverified here) | React runtime plus hydration | MDX is manual | Most proven canvas pattern, highest JS cost |
| SvelteKit | Root layout persists (unverified here) | Small runtime | mdsvex or manual | Good fallback |
| Vite SPA | Trivial | All JS | Manual | Weak SEO and a slower first paint |

Verified in [Astro's View Transitions guide](https://docs.astro.build/en/guides/view-transitions/):

- `transition:persist` keeps an element or island alive, and island state is kept. `transition:persist-props` keeps the old props.
- CSS animations restart and iframes reload on navigation. This can't be avoided.
- `<ClientRouter />` respects `prefers-reduced-motion` and has fallbacks for non-Chromium browsers.
- Bundled module scripts run once. Use an `astro:page-load` listener for per-navigation setup.

Unverified: whether a moved `<canvas>` keeps its WebGPU context.

## Hosting facts

### Vercel

From [Vercel pricing](https://vercel.com/docs/pricing) and [Flat Rate CDN](https://vercel.com/docs/pricing/flat-rate-cdn), both updated 2026-09-14:

- Pro includes 1M requests and 1 TB of transfer.
- Higher tiers cost $20, $100, or $300 a month.
- Vercel Blob falls under the same fair-use terms.

### Cloudflare R2

From [R2 pricing](https://developers.cloudflare.com/r2/platform/pricing/):

- Storage costs $0.015 per GB-month, and egress is free.
- Class A operations cost $4.50 per million. Class B operations (reads) cost $0.36 per million.
- The free tier includes 10 GB of storage, 1M Class A operations, and 10M Class B operations.

### R2 public access

From [public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/):

- `r2.dev` is for development only.
- A custom domain uses Cloudflare Cache. Turn on Smart Tiered Cache.
- KTX2 and tile files need a Cache Everything rule.

### Pages vs Workers

Cloudflare steers new projects to Workers with static assets ([migration guide](https://developers.cloudflare.com/workers/static-assets/migrate-from-pages/)). Use the Astro Cloudflare adapter with `wrangler deploy`.

## Unverified

- COOP and COEP headers are needed only for `SharedArrayBuffer`. Cross-origin assets then need CORS or CORP headers, which is another reason to keep assets on the same origin.
- R2 range requests through the CDN are unconfirmed. Prefer separate immutable tile files with `Cache-Control: public, max-age=31536000, immutable`.
- `.dev` is on the HSTS preload list, so HTTPS is mandatory. Both hosts provision certificates automatically.

## Gaps

- No latency benchmark comparing Vercel and Cloudflare.
- No test of Astro's persist with a WebGPU canvas.
- Vercel Flex CDN rates are unchecked.
