# falsy.dev

Justin Powell's portfolio and consulting site, with a planet rendered from real data behind the content. The spec is in [`docs/SPEC.md`](docs/SPEC.md), and the phased plan is in [`docs/PLAN.md`](docs/PLAN.md).

## Run it

```bash
npm install
npm run dev       # http://localhost:4321
npm run build     # static site in dist/
npm run preview
```

### Live scene locally

```bash
npm install
npm run tiles                  # once for Mars: downloads the USGS mosaics (about 15 GB) and bakes the tiles (about 2 GB)
npm run tiles -- --body moon   # once for the Moon: downloads LOLA heights and SVS colour (about 3 GB) and bakes the tiles
npm run dev
```

Then open http://localhost:4321. The live scene starts on desktop-width windows with WebGPU or WebGL2, and the poster shows until the first frame. Source mosaics and tiles live in `~/.cache/falsy-dev` (override with `FALSY_DATA_DIR`), outside the repo. The dev server serves them at `/data`; builds never include them. The steps run separately as `tiles:fetch`, `tiles:heights`, and `tiles:colour`, each taking `--body mars` (the default) or `--body moon`; `tiles:colour -- --near 18.65,226.2,800` cuts only the level-3 tiles within 800 km of a point. Each body's sources and how to read them are listed in `scripts/tiles/paths.mjs`; everything else about a body (radius, orbit, lighting, features) is in `src/scene/bodies.ts`. `node scripts/tiles/budget.mjs` estimates download size per view by replaying real orbits through the renderer's tile selection. For Earth it adds the cloud map, and against a partial bake (such as `FALSY_DATA_DIR=~/.cache/falsy-dev/earth-test`) it counts each missing tile at the mean size of its layer's baked tiles at that level.

#### Earth tiles

Earth's sources ship as tiles, so its bake adds a mosaic step and an optional Sentinel-2 step: `npm run tiles -- --body earth` runs fetch, `earth-mosaic`, `earth-sentinel`, heights, colour, and lights.

- Fetch downloads GEBCO_2026's eight ice-surface GeoTIFFs (about 7.5 GB), the eight Blue Marble Next Generation 500 m tiles for the bake month (about 0.5 GB), Black Marble 2016's eight 500 m greyscale tiles plus its 3 km map (about 0.2 GB), and Natural Earth's 1:10m land polygons.
- `node scripts/tiles/earth-mosaic.mjs` writes rasters under `sources/earth-mosaic` (about 18 GB): heights and city lights at 1/120°, plus the water mask and Blue Marble colour at 1/240°. The mask is GEBCO height at or below sea level, except inside Natural Earth land.
- `node scripts/tiles/earth-sentinel.mjs` overlays the Copernicus Sentinel-2 Global Mosaic, the latest quarter of the current season, through its cloud-optimized overviews at about 300 m. It needs the Copernicus Data Space S3 keys in `COPERNICUS_S3_ACCESS_KEY` and `COPERNICUS_S3_SECRET_KEY`; without them it skips, and colour stays Blue Marble. `--list` runs the item search without keys. `EARTH_BAKE_DATE` picks a different season. The tone curve is `TONE` in `scripts/tiles/earth/sentinel.ts`. It prints the year for `EARTH.tiles.sentinelYear` in `src/scene/bodies.ts`; set it before you upload, so the footer credits Copernicus only when the colour holds Sentinel-2 data.
- Colour tiles stop at level 6 and carry the mask in alpha (opaque is land). `meta.json` gains `flatOcean`, a per-tile bitmap of open-ocean height tiles (layout in `src/scene/tiles/flat-ocean.ts`).
- `node scripts/tiles/lights.mjs --body earth` cuts the city-lights layer (`l/`): 128 px single-channel AVIF to level 6, averaged in light rather than in grey (`src/scene/tiles/lights-codec.ts`). The scene fetches it only for night-side tiles in view.
- `node scripts/tiles/lights-grid.mjs` regenerates `src/scene/lights-grid.ts`, the committed 1° lights grid that shot planning reads. It needs only the 3 km map (`earth-mosaic.mjs --coarse lights`).
- `node scripts/tiles/masked-decode/check.mjs --url http://localhost:4321` checks, against a running dev server, that the browser keeps colour under alpha 0 in Chromium and WebKit, on WebGPU and WebGL2.

Earth is in `BODIES` but has `listed: false` in `src/scene/bodies.ts`, so production's first-visit picks and the body button leave it out until its production tiles and clouds exist. `?body=earth` still shows it, and development lists every body, so without local Earth tiles a development visit can land on Earth and fall back to a poster, and the body button stops at Earth. Flip `listed` to `true` once `earth/v1` is uploaded.

To run the dev server against a test bake for one body, point `FALSY_TILES_<BODY>` at its tile folder; other bodies keep loading from `~/.cache/falsy-dev/tiles`:

```bash
FALSY_TILES_EARTH=~/.cache/falsy-dev/earth-test/tiles/earth npm run dev
```

A small test bake, without the full downloads, sets `FALSY_DATA_DIR=~/.cache/falsy-dev/earth-test` and runs:

```bash
node scripts/tiles/fetch-sources.mjs --body earth naturalEarthLand,gebcoCoarse,bmngCoarse,bmngC1,blackMarbleCoarse,blackMarbleC1
node scripts/tiles/earth-mosaic.mjs --coarse
node scripts/tiles/earth-mosaic.mjs heights --box 44.3,-0.1,56.4,16.7 --remote   # crosses GEBCO's B1/C1 seam
node scripts/tiles/earth-mosaic.mjs colour --box 44.3,0,56.4,16.7             # inside Blue Marble C1
node scripts/tiles/earth-mosaic.mjs lights --box 44.3,0,56.4,16.7             # inside Black Marble C1
node scripts/tiles/heights.mjs --body earth --near 52.3,5.3,500
node scripts/tiles/colour.mjs --body earth --near 52.3,5.3,500
node scripts/tiles/colour.mjs --body earth --leaf-level 3
node scripts/tiles/lights.mjs --body earth --near 52.3,5.3,500
node scripts/tiles/lights.mjs --body earth --leaf-level 3
```

Production builds read the tile base URL from `PUBLIC_TILES_BASE` in `.env.production` (the R2 bucket at `tiles.falsy.dev`), and load `<base>/<body>/<version>`, for example `mars/v1`. In development, tiles come from `/data/<body>`. `doppler run -p falsy-dev -c prd -- npm run tiles:upload -- --body moon` sends a body's tiles to R2. Secrets live in the `falsy-dev` Doppler project.

| Parameter | Effect |
|---|---|
| `body=mars`, `body=moon`, `body=earth` | Show this body instead of the usual alternation. The body name in the readout switches to the next one, live or as a poster. Works for a body that isn't listed yet (see below). |
| `live=1` / `live=0` | Force the live scene on or off, ignoring screen width and reduced motion |
| `shot=dawn-dusk`, `shot=orbital-sunrise`, `shot=feature-flyover`, `shot=night-pass` | Pick the orbit instead of a weighted random one. `night-pass` (Earth only) flies over lit cities on the night side. |
| `shot=home-pass` | Earth only: fly beside the browser's timezone city, as a first Earth visit does. Falls back to the normal mix when the zone is unusable or the ground is dark without lights. To try another zone, emulate one in DevTools (Sensors) or Playwright (`timezoneId`). |
| `t=N` | Preview at N× real time, or `t=0` to hold one moment. The readout shows `t×N` whenever it isn't 1. |
| `at=2026-11-03T20:00:00Z` | Start at this moment instead of now. Lighting and orbit follow from it. On Earth, the clouds are the set from the 6 hours before that moment, or the static map if there is none. |
| `feature=olympus-mons` | Fly over this feature whatever its time of day. IDs are in `src/scene/features.ts`. |
| `seed=N` | Make the random choices (shot type, orbit direction) repeatable. With `at=`, the same URL gives the same view. |
| `alt=N` | Orbit altitude in km (120 to 2000). The default is per body: 200 for Mars, 100 for the Moon, 400 for Earth. Orbital speed follows from it. |
| `tilt=N` | Degrees the camera looks below the horizon, beyond the geometric dip. Higher shows more ground moving. By default the framing solver picks it for the viewport. |
| `skip=N` | Starts the clock N seconds into the shot, for stills of a chosen moment (for example `skip=50` on an orbital sunrise). |
| `roll=N` | Degrees the camera banks right, dropping the horizon on the left. By default the framing solver picks it, so the limb passes below the hero text and rises to the right. |
| `fov=N` | Vertical field of view in degrees (default 50). Narrower magnifies the motion. |
| `far=N` | Distance in km beyond which terrain detail relaxes in proportion (default 500, `far=0` for full detail everywhere). The main lever on download size. |
| `tier=high`, `tier=medium`, `tier=low` | Force a quality tier and stop the automatic step-down, to compare them. `window.__falsyLive.state` shows the tier, `gpuMs`, any tier changes, MSAA samples (`msaa`), and the scene's estimated GPU memory (`gpuMemoryMB`). |
| `scale=N` | Render at N device pixels per CSS pixel (0.5 to 3, never above the screen's own), overriding the tier's resolution. For comparing sharpness. The scene keeps the tier's MSAA however large the canvas gets, as the posters need. |
| `webgl` | Force the WebGL2 backend |
| `fx=shadows,bloom` | Turn these scene layers off (on Earth also `glint`, `clouds`, `cloudShadows`, and `lights`; `atmosphere` hides the air's shell, and the clouds drawn in it), to measure what each costs. Layers are listed in `src/scene/fx.ts`; unknown names are ignored. `window.__falsyLive.state.fx` shows which layers are off. |
| `bench=N` | Render each frame N times back to back (1 to 64) and log the GPU time per frame, for the frame-time benchmark. |
| `ph=1` | Turn on PostHog analytics off the production host. Events go through the `/uplink` relay, which only the Worker serves, so test a build with `npm run build && npx wrangler dev`, not `astro preview` or `astro dev`. Headless browsers also need `navigator.webdriver` masked, or posthog-js drops their events as bots. |

## Where things live

| Path | What |
|---|---|
| `src/config/brand.ts` | Consultancy name, URLs, booking link, and email. Rename the consultancy here. |
| `src/content/projects/` | One Markdown file per project. Front matter drives the card and the facts list. |
| `src/components/Stage.astro` | The persisted background: poster, sky grid, and telemetry readout. |
| `src/data/posters.json` | Poster metadata, written by the poster pipeline |
| `scripts/posters/` | Poster pipeline: `render.mjs` screenshots the live scene, and `encode.mjs` writes AVIF files. `bench.mjs` measures frame time per layer. |
| `src/scene/tiles/` | Cube-sphere tile addressing, LOD selection, and the tile file formats |
| `scripts/tiles/` | Tile pipeline: source download, height and colour cutters, budget estimate |
| `clouds/` | Cloud job: a cron Worker and a container that turn NOAA GMGSI into Earth's cloud texture |
| `prototypes/mars-orbit/` | The original Mars rendering prototype, kept for reference |
| `docs/` | Spec, plan, ADRs, research, copy, and design references |

## Posters

The posters are a fixed set of stills, committed in `public/posters`. They show on phones, with reduced motion or Data Saver, and whenever the live scene can't run. Each is rendered by the live scene itself on a machine with a GPU, so it needs the local tiles:

```bash
node scripts/posters/render.mjs            # starts astro dev; or --url http://localhost:4321, --only <id>
node scripts/posters/encode.mjs posters-out/frames.json
```

Shots are defined in `scripts/posters/shots.json` as live-scene URL parameters with a pinned time, so re-rendering gives the same frames. Each shot renders twice: a landscape still framed for a laptop layout, and a portrait still framed for a phone layout, which tall screens get. `portraitQuery` can pick a different moment for the portrait still. The first shot also becomes `public/og.jpg`.

Earth stills also need their own moment's clouds. The dev server can't read `clouds.falsy.dev` (CORS), so build each Earth shot's cloud set from NOAA's GMGSI archive into the local stand-in first. It downloads about 110 MB of GMGSI files per 3-hour set, cached in `~/.cache/falsy-dev/sources/gmgsi`:

```bash
cd clouds/container && npm ci && cd ../..
node clouds/scripts/poster-sets.mjs        # writes kept/<valid>/ and kept/index.json under ~/.cache/falsy-dev/tiles/clouds (FALSY_TILES_CLOUDS)
```

A full `render.mjs` run renders only listed bodies, so Earth's shots join it once Earth is listed; `--only earth-glint` renders one before then. `render.mjs` refuses an Earth still whose clouds aren't the set for its moment. The cloud job keeps a poster's set only if the moment falls after the job started running, so copy the local `kept/` directory into the `falsy-clouds` bucket for earlier moments, and redeploy the cloud job after changing `shots.json`, since it bundles the file. The page leaves Earth stills out until Earth is listed (see above).

## Frame-time benchmark

`scripts/posters/bench.mjs` measures what each scene layer costs the GPU. It renders one pinned poster shot in headless Chromium over WebGPU, once with every layer on and once with each `fx=` toggle, waits for every tile to settle, and collects GPU frame times. Runs alternate in mirrored rounds (all on, shadows, bloom, then bloom, shadows, all on), so a GPU that warms up or throttles over the session weighs on every toggle alike. It prints p10, median, and p90 per toggle, each with its difference from all layers on. Like the posters, it needs the local tiles.

```bash
node scripts/posters/bench.mjs                          # starts astro dev; or --url http://localhost:4321
node scripts/posters/bench.mjs --tier low --toggles shadows,bloom,shadows+bloom
```

| Option | Default | Effect |
|---|---|---|
| `--shot` | `mars-olympus` | Shot ID from `scripts/posters/shots.json`. Its pinned time and `t=0` hold the view still. |
| `--query` | | URL parameters for a view not in `shots.json`, in place of `--shot`, such as `body=earth&shot=dawn-dusk&seed=1&at=2026-11-22T11:00:00Z`. Pin `at` to hold it still. |
| `--tier` | `high` | Quality tier to force |
| `--toggles` | every layer in `src/scene/fx.ts` | Comma-separated `fx=` values to compare. `a+b` turns several layers off in one run. |
| `--rounds`, `--samples` | 5, 90 | Rounds of every toggle, and frame times kept per run (at most 120) |
| `--repeat` | 16 | Renders per frame (`bench=`). Use 1 to measure frames exactly as the governor does. |
| `--width`, `--height`, `--dpr` | 1440, 900, 2 | Viewport in CSS pixels and the browser's device pixel ratio |
| `--scale` | the tier's own | Render at this pixel ratio. The scene never renders above the screen's ratio, so the browser's ratio is raised to match. |

Each run checks that the scene turned off the layers it asked for and that the canvas has the expected size, so a run at a given scale really renders at that scale. The header prints the GPU and the canvas size.

GPU time is the time from submitting a frame until the GPU reports it done (`onSubmittedWorkDone`), the same measure the governor and the `scene_perf` event use. WebGPU timestamp queries aren't used: three.js adds up per-pass spans, which overlap on Apple GPUs and read several times high. Read the numbers with these limits in mind:

- At the tier's frame rate, a fast GPU idles most of each frame and drops its clocks, so one frame's time says more about the clock than the work. On an M5 Max, Mars at High read a 6 ms median that way, against 1.7 ms per frame with `--repeat 16`, and turning shadows or bloom off made frames read slower, not faster.
- `--repeat` renders each frame several times back to back, which keeps the GPU busy and its clock up. Raise it until the all-on run medians agree to within about 0.2 ms, and until no toggle reads slower than all on. On an M5 Max that took 16; at 8, runs still varied by 0.5 ms. A slower GPU needs fewer.
- Each batch waits for the GPU to finish the one before. Before it did, a batch that took longer than the frame interval queued behind the last one and was timed with its backlog, which read slow layers several times too high (an Earth limb view read 11 ms instead of 2.7 to 4.1).
- The time per frame still includes the browser's delay in reporting completion, divided by the repeat count, and the CPU's time to encode each render if the CPU is the slower side. Compare toggles within one run of the script, not absolute numbers across repeat counts or machines.
- Close other GPU work first. Other browser tabs, a second dev server rendering posters, or a video call all show up in the numbers.

## Deploy

Cloudflare Workers Builds deploys the Worker (`wrangler.jsonc`, static assets in `dist`, and the PostHog relay in `worker/`) on every push to `main`: the Cloudflare project `falsy-dev` is connected to this repo, with build command `npm run build` and deploy command `npx wrangler deploy`. GitHub Actions only runs checks (type check, tests, build, Lighthouse) and needs no Cloudflare credentials.

Tiles are served from the R2 bucket `falsy-tiles` at `tiles.falsy.dev`; see "Live Mars locally" for uploads. Secrets live in the Doppler project `falsy-dev`.

### Cloud job

`clouds/` is a separate Worker, deployed by hand. Every 3 hours (at minute 50, after NOAA's hourly file lands), its cron trigger finds the newest NOAA GMGSI longwave file, passes it and the clear-sky history to a `standard-1` Cloudflare Container, and writes the results to the R2 bucket `falsy-clouds` (served at `clouds.falsy.dev`) through a binding. It needs no API token or secret.

- `dated/<valid>/clouds.avif` and `meta.json`: a 4096×2048 opacity texture (equirectangular, row 0 at 90°N, column 0 at 180°W; read the red channel) and its metadata. Immutable.
- `latest.json`: the set the site shows, with `path`, the metadata, `fallback` (`source-missing`, `source-stale`, `process-failed`, `warming-up`, or `null`), `stale` (older than 6 hours), and `checked`. Written last, with a 5-minute cache.
- `kept/<valid>/` and `kept/index.json`: the set each Earth poster in `scripts/posters/shots.json` was pinned to, kept past the 14-day expiry.
- `state/<hour>/<day>`: the clear-sky history, one gzipped plane per 3-hour run per day.

When the clouds are older than about 6 hours, each run logs `clouds stale: …` and fails, so a Cloudflare notification on the Worker's errors can alert. Run it locally (Docker required; local R2 only, nothing reaches the real bucket):

```bash
cd clouds && npm ci
npx wrangler dev --test-scheduled --port 4437
curl "http://localhost:4437/__scheduled?cron=50+*/3+*+*+*"
```

Deploy with `cd clouds && npm ci && npx wrangler deploy`. It builds and pushes the container image, so Docker must be running.

The scene reads `latest.json` from `PUBLIC_CLOUDS_BASE` (`https://clouds.falsy.dev` in `.env.production`) and loads the set it names. With `at=`, it loads the newest set from the 6 hours before that moment from `dated/` or `kept/`. A tab coming back from the background reloads the clouds only when `latest.json` names a newer set. When the live source is missing or unreachable, Earth falls back to the static set in `public/clouds/` (`static.avif`, and `static.json` in the shape of `latest.json`), made by the container's own handler from the 2026-11-22 11:00 UTC file and the 14 days before it at the same hour.

The bucket's CORS rule only allows `https://falsy.dev`, so in development the scene reads a local stand-in at `/data/clouds`, served from `~/.cache/falsy-dev/tiles/clouds` (or `FALSY_TILES_CLOUDS`). Without one, dev shows the static map. `node clouds/scripts/dev-bucket.mjs 2026-11-22T09:00:00Z` adds a set valid at that time, copied from the static map, and points `latest.json` at it; `--no-latest` adds a dated set only. To remake it, download those files from `noaa-gmgsi-pds` and run `node clouds/scripts/make-static.mjs <newest .nc> public/clouds <earlier .nc>...`.

Analytics go to the PostHog project `falsy.dev` (US Cloud). `src/analytics.ts` loads posthog-js after the page is idle, and only on `falsy.dev`, so dev, Lighthouse CI, and PR previews send nothing. Events go through `/uplink/*` on the site itself, which `worker/index.js` relays to PostHog, so ad blockers that block posthog.com don't drop them. That path is the only one that runs the Worker; everything else is served as static assets. The project token is in `.env.production`: it's public by design, since it can only send events and ships in the page anyway. It runs in cookieless mode: nothing is stored in the browser, and PostHog counts a returning visitor as new each day. Besides pageviews and clicks, a `scene_shown` event records whether each visitor got the live orbit or a poster, with the GPU backend and quality tier.
