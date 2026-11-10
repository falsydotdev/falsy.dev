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
| 4. Poster pipeline | Replaced in Phase 2 (2026-11-04): six fixed stills rendered by the live scene on a local GPU, each in a landscape and a portrait framing, committed to the repo. The daily SwiftShader job is gone. |
| 5. Contact | Done: HubSpot meetings link and plain-text email |
| 6. Deploy | Cloudflare Workers Builds deploys `main` (project `falsy-dev`, connected 2026-11-03). Tiles are in R2 bucket `falsy-tiles` at `tiles.falsy.dev`. GitHub Actions only runs checks. |
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

**Status (2026-11-03):** tile pipeline and streaming renderer built on branch `phase-2/tiles`. See ADR 0004 for formats.

| Step | State |
|---|---|
| 1. Tile pipeline | Done: 131,070 colour (AVIF) and height tiles, levels 0 to 7, plus a coarse shadow map, about 1.6 GB. Built in `~/.cache/falsy-dev` and uploaded to R2. |
| 2. Terrain renderer | Quadtree LOD on an equi-angular cube-sphere, one instanced draw, array-texture atlases with LRU eviction, ancestor fallback while streaming, coarse-map shadows. Works on WebGPU and WebGL2. Floating origin and reversed depth aren't needed at 200 km: tile positions are precise to about 0.5 m. |
| Budget | `scripts/tiles/budget.mjs`, 12 shots × 90 s at 3200×1800: 6.4 MB first view and 8.9 MB after 90 s with the default 500 km far relaxation (9.1 and 12.1 MB without it). Tilt changes nothing while the horizon is in frame. |
| 6. Quality tiers | Done. High, Medium, and Low change render resolution (up to 1.25×, 1×, 0.75×, each with a pixel cap), bloom, and frame rate (30, 30, 20). Side by side on a fixed frame, 2× with 44 shadow steps differed from 1× with 12 by under 1/255 per pixel, so the defaults dropped to what's visible. The start tier comes from the GPU vendor, then the scene measures GPU time per frame and steps down when it passes 60% of the frame interval, crossfading like a tab return. It never steps back up. Past Low, it freezes on its last frame. Data Saver gets the poster. On an M5 Max with a 2× screen, High costs about 7 ms per frame (the old 2× High cost 16 ms). |
| 3. Atmosphere | Done. Hillaire-style tables (optical depth, and light scattered more than once) are built in a worker at startup in about 100 ms, then the shader marches 24 steps per pixel with table lookups instead of a nested sunlight march. Multiple scattering adds a faint orange twilight arc on the night side. Light shafts test each sunbeam against the coarse height map at its lowest point, so tall terrain at the limb (Tharsis) cuts streaks into the sunrise glow. The haze now stops at the terrain instead of the bare sphere. Cost is about +0.5 ms per frame at High on an M5 Max. Temporal accumulation wasn't needed. |
| 4. Composition | Done. `src/scene/composition.ts` grid-searches camera pitch and roll per viewport, so the limb and its glow pass under the measured hero text and rise toward the upper right (about 10° of roll on a laptop). Shots put the dayside, the flyover feature, and the sunrise on the right. Re-solved on resize. |
| Robustness | Bounded tile records and GPU memory (soak-tested over 35 orbit-minutes), poster fallback on GPU device loss, and a crossfade from the last frame when a background tab returns. |

**Done when:**
- A typical view loads 20 MB or less of tiles.
- It holds High at 30 fps on an M-series laptop, and Medium or better on a mid-range Windows laptop. (Frame rate is capped at 30, since the camera moves too slowly for more to show.)
- The poster fallback works on phones.

## Phase 3: The Moon

1. Cut tiles from LROC color and LOLA elevation.
2. Render with no atmosphere and a black sky, and keep the harsh shadows.
3. Add a feature list of about 10 entries, such as Tycho, Copernicus, and the south pole.
4. Turn on weighted body rotation, with no repeats for a visitor.

**Done when:** loads alternate between Mars and the Moon, and both meet the Phase 2 budgets.

| Step | State |
|---|---|
| Body config | `src/scene/bodies.ts` holds everything body-specific (radius, GM, altitude, relief, features, Sun size, limb glow, atmosphere, lighting, shot mix). Ephemeris, orbits, shots, framing, and the renderer take a body. Mars renders pixel-identical to before. |
| 1. Tiles | Done: 131,070 colour and height tiles from NASA SVS's 2025 LROC colour map (16384 px wide, about 666 m/px) and LOLA `ldem_128` heights (237 m/px), plus the shadow map, about 1.5 GB in R2 at `moon/v1`. `--body moon` on every tile script. |
| 2. Rendering | No scattering shell, no haze, no skylight. The terrain shadow test now runs down to the horizon dip of the tallest exaggerated peaks, so night-side slopes stay dark. The terminator pass runs 10° into daylight, since ground right at an airless terminator is almost all shadow. Sunrise starts 15 s before the Sun clears 15 km of limb mountains, with no glow. |
| 3. Features | Eleven, including Tycho, Copernicus, Aristarchus, Tranquility Base, and Tsiolkovskiy. A low-Sun feature exists on about two thirds of half-day steps through a lunation; otherwise the flyover falls back to the terminator pass. Shackleton was dropped on 2026-11-10: with the Sun 0 to 2° up, the view was almost all black. |
| Night side | Added 2026-11-10. Every Moon orbit spends about half of its 2 hours over unlit ground, so a long visit or a tab left in the background showed black with the readout still moving. Once a shot is 10 minutes past its key moment and the Sun under the camera drops below the body's cutoff (5° on the Moon, −4° on Mars, both measured from renders), the scene crossfades to a new shot from the current time. URLs that pin the view (`at`, `seed`, `skip`, `feature`) never re-shoot. |
| 4. Rotation | A visitor's first load picks a body at random, and later loads alternate. `?body=` overrides. Three Moon posters join the six of Mars. |
| Switcher | The body name in the readout is a button. Live, the other body loads under the one on screen, which keeps moving, and the two crossfade once the new view has a frame (about 0.6 s locally, capped at 2.5 s); the old scene is then disposed and the quality governor resumes. The lowest tier and WebGL2 freeze the old frame and fade from that instead of running two scenes. The other body's coarse tiles (levels 0 to 2) are pre-fetched when the browser is idle. Posters crossfade to a still of the other body. The accent eases between bodies, and `data-body` now survives client-side navigation. PostHog gets `body_switched`. |
| Budget | 12 shots × 90 s at 3200×1800: 7.1 MB first view and 9.3 MB after 90 s (Mars: 6.4 and 9.0). LOLA heights carry more real detail and compress less; the softer colour compresses more. |

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
