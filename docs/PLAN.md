# falsy.dev v1 build plan

Phases build on each other on stacked branches. Nothing launches until Phase 2 is done; then everything merges to `main` together and goes live with live Mars (decided 2026-11-03). See [`SPEC.md`](SPEC.md) for the what and why.

## Phase 0: Direction

1. Mock two or three type-and-color directions over a hero still render. Show each on the hero and on one project card. Justin picks one.
2. Draft all copy in Justin's voice with `sound-like-justin`: hero line, consulting offer, three project write-ups, about, and the 404 page. Justin edits.

**Done when:** a direction is chosen and the copy is approved.

## Phase 1: Site shell, live with posters

1. **Persistence spike:** check that an Astro `transition:persist` island keeps a WebGPU canvas alive across navigation. If it fails, switch to SvelteKit (ADR 0002).
2. **Astro project:**
   - Content collections for projects.
   - Pages for the home page, three projects, and the 404 page.
   - Brand config for RevOps Rocks.
3. **Design system:** tokens, type, and layout from Phase 0, with glass styling for panels that use the CSS fallback.
4. **Poster pipeline:** a still frame per body and shot from the prototype renderer, plus the daily job that refreshes them. Pick a host for the job that can render WebGPU or WebGL2 headless.
5. **Contact:** the HubSpot meetings link and plain-text email.
6. **Deploy:**
   - Cloudflare Workers static assets on `falsy.dev`.
   - An R2 bucket and caching rules.
7. **Performance budget:** text interactive in under one second on a mid-range phone over 4G. Check it with Lighthouse in CI.

**Done when:** falsy.dev is live with real content, a poster background, and working booking.

**Status (2026-11-03):** built on branch `phase-1/site-shell` (draft PR #2). It won't launch on its own: it merges with Phase 2.

| Step | State |
|---|---|
| 1. Persistence spike | Passed. See ADR 0002. |
| 2. Astro project | Done: home, three project pages, 404, and `src/config/brand.ts` |
| 3. Design system | Done: Direction D tokens in `src/styles/global.css`, self-hosted fonts |
| 4. Poster pipeline | Three Mars stills. `scripts/posters/render.mjs` and `encode.mjs` run locally. The daily job runs on GitHub Actions with SwiftShader WebGL2 (`.github/workflows/posters.yml`), switched on by the `POSTERS_ENABLED` variable. |
| 5. Contact | Done: HubSpot meetings link and plain-text email |
| 6. Deploy | `wrangler.jsonc` and the CI deploy job are ready. They need the Cloudflare secrets and `DEPLOY_ENABLED=true`. No R2 bucket yet, because nothing uses one until Phase 2. |
| 7. Performance budget | Lighthouse CI on every PR, using mobile with simulated slow 4G. Home: performance 99 to 100, accessibility, best practices, and SEO all 100. First contentful paint is 1.13 s, and largest contentful paint is 1.65 to 1.8 s. |

## Phase 2: Live Mars

1. **Tile pipeline:** extend `build-data.mjs` into a tile cutter with these outputs:
   - The MOLA and Viking pyramid as KTX2.
   - Normal maps precomputed at 2.5× relief.
   - Upload to R2.
2. **Terrain renderer:** quadtree LOD on a cube-sphere, with tile streaming, height-texture shadows, and a floating origin with reversed depth.
3. **Atmosphere:** port the prototype's scattering to a precomputed-LUT version. Add light shafts for the orbital sunrise shot, and temporal accumulation for the heavy passes.
4. **Shot director:**
   - Orbit selection, with the starting point chosen per shot type.
   - A Mars feature list of about 10 entries.
   - A low-Sun filter.
   - Composition rules that keep the text column clear.
   - The real-time clock, and orbit propagation at real orbital speed.
   - Three orbit types: dawn-dusk, orbital sunrise, and feature flyover.
5. **Telemetry readout:** live coordinates, local solar time, altitude, orbital speed, and relief. The click handler is stubbed for v2.
6. **Quality tiers:**
   - Measure frame rate in the first second and pick a tier.
   - Pause when hidden or scrolled away.
   - Respect reduced motion.
   - Keep the poster crossfade.
7. **Glass panels:** renderer-drawn glass behind text boxes that overlap the planet.
8. **Baked shading:** evaluate de-shading the Viking mosaic.

**Done when:**
- A typical view loads 20 MB or less of tiles.
- It holds 60 fps on an M-series laptop, and 30 fps or better on a mid-range Windows laptop.
- The poster fallback works on phones.

## Phase 3: The Moon

1. Cut tiles from LROC color and LOLA elevation.
2. Render with no atmosphere and a black sky, and keep the harsh shadows.
3. Add a feature list of about 10 entries, such as Tycho, Copernicus, and the south pole.
4. Turn on weighted body rotation, with no repeats for a visitor.

**Done when:** loads alternate between Mars and the Moon, and both meet the Phase 2 budgets.

## Phase 4: Analytics and form

1. PostHog in cookieless mode, tracking:
   - Page views
   - Booking clicks
   - Form submissions
   - Easter-egg discovery
   - Quality tier
2. The "tell me about your project" form, posting to the HubSpot Forms API.
3. Make the repo public, after checking that no secrets are in its history.

**Done when:** events show in PostHog and form submissions land in HubSpot.

## Later releases

- Earth, with that day's NASA cloud imagery and Black Marble city lights.
- Jupiter, with differential band rotation.
- Saturn, with ring shadows.
- The v2 explorer, after its own grilling session.
