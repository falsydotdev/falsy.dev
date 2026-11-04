# falsy.dev

Justin Powell's portfolio and consulting site, with a planet rendered from real data behind the content. The spec is in [`docs/SPEC.md`](docs/SPEC.md), and the phased plan is in [`docs/PLAN.md`](docs/PLAN.md).

## Run it

```bash
npm install
npm run dev       # http://localhost:4321
npm run build     # static site in dist/
npm run preview
```

### Live Mars locally

```bash
npm install
npm run tiles     # once: downloads the USGS mosaics (about 15 GB) and bakes the tile set (about 2 GB)
npm run dev
```

Then open http://localhost:4321. The live scene starts on desktop-width windows with WebGPU or WebGL2, and the poster shows until the first frame. Source mosaics and tiles live in `~/.cache/falsy-dev` (override with `FALSY_DATA_DIR`), outside the repo. The dev server serves them at `/data`; builds never include them. The steps run separately as `tiles:fetch`, `tiles:heights`, and `tiles:colour`; `tiles:colour -- --near 18.65,226.2,800` cuts only the level-3 tiles within 800 km of a point. `node scripts/tiles/budget.mjs` estimates download size per view by replaying real orbits through the renderer's tile selection.

Production builds read the tile base URL from `PUBLIC_TILES_URL` in `.env.production` (the R2 bucket at `tiles.falsy.dev`). `doppler run -p falsy-dev -c prd -- npm run tiles:upload` sends the tiles to R2. Secrets live in the `falsy-dev` Doppler project.

| Parameter | Effect |
|---|---|
| `live=1` / `live=0` | Force the live scene on or off, ignoring screen width and reduced motion |
| `shot=dawn-dusk`, `shot=orbital-sunrise`, `shot=feature-flyover` | Pick the orbit instead of a weighted random one |
| `t=N` | Preview at N× real time, or `t=0` to hold one moment. The readout shows `t×N` whenever it isn't 1. |
| `at=2026-11-03T20:00:00Z` | Start at this moment instead of now. Lighting and orbit follow from it. |
| `feature=olympus-mons` | Fly over this feature whatever its time of day. IDs are in `src/scene/features.ts`. |
| `seed=N` | Make the random choices (shot type, orbit direction) repeatable. With `at=`, the same URL gives the same view. |
| `alt=N` | Orbit altitude in km (120 to 2000, default 200). Orbital speed follows from it. |
| `tilt=N` | Degrees the camera looks below the horizon, beyond the geometric dip. Higher shows more ground moving. By default the framing solver picks it for the viewport. |
| `skip=N` | Starts the clock N seconds into the shot, for stills of a chosen moment (for example `skip=50` on an orbital sunrise). |
| `roll=N` | Degrees the camera banks right, dropping the horizon on the left. By default the framing solver picks it, so the limb passes below the hero text and rises to the right. |
| `fov=N` | Vertical field of view in degrees (default 50). Narrower magnifies the motion. |
| `far=N` | Distance in km beyond which terrain detail relaxes in proportion (default 500, `far=0` for full detail everywhere). The main lever on download size. |
| `tier=high`, `tier=medium`, `tier=low` | Force a quality tier and stop the automatic step-down, to compare them. `window.__falsyLive.state` shows the tier, `gpuMs`, and any tier changes. |
| `scale=N` | Render at N device pixels per CSS pixel (0.5 to 3, never above the screen's own), overriding the tier's resolution. For comparing sharpness. |
| `webgl` | Force the WebGL2 backend |

## Where things live

| Path | What |
|---|---|
| `src/config/brand.ts` | Consultancy name, URLs, booking link, and email. Rename the consultancy here. |
| `src/content/projects/` | One Markdown file per project. Front matter drives the card and the facts list. |
| `src/components/Stage.astro` | The persisted background: poster, sky grid, and telemetry readout. |
| `src/data/posters.json` | Poster metadata, written by the poster pipeline |
| `scripts/posters/` | Poster pipeline: `render.mjs` screenshots the live scene, and `encode.mjs` writes AVIF files |
| `src/scene/tiles/` | Cube-sphere tile addressing, LOD selection, and the tile file formats |
| `scripts/tiles/` | Tile pipeline: source download, height and colour cutters, budget estimate |
| `prototypes/mars-orbit/` | The original Mars rendering prototype, kept for reference |
| `docs/` | Spec, plan, ADRs, research, copy, and design references |

## Posters

The posters are a fixed set of six stills, committed in `public/posters`. They show on phones, with reduced motion or Data Saver, and whenever the live scene can't run. Each is rendered by the live scene itself on a machine with a GPU, so it needs the local tiles:

```bash
node scripts/posters/render.mjs            # starts astro dev; or --url http://localhost:4321, --only <id>
node scripts/posters/encode.mjs posters-out/frames.json
```

Shots are defined in `scripts/posters/shots.json` as live-scene URL parameters with a pinned time, so re-rendering gives the same frames. Each shot renders twice: a landscape still framed for a laptop layout, and a portrait still framed for a phone layout, which tall screens get. `portraitQuery` can pick a different moment for the portrait still. The first shot also becomes `public/og.jpg`.

## Deploy

Cloudflare Workers Builds deploys the Worker (`wrangler.jsonc`, static assets in `dist`) on every push to `main`: the Cloudflare project `falsy-dev` is connected to this repo, with build command `npm run build` and deploy command `npx wrangler deploy`. GitHub Actions only runs checks (type check, tests, build, Lighthouse) and needs no Cloudflare credentials.

Tiles are served from the R2 bucket `falsy-tiles` at `tiles.falsy.dev`; see "Live Mars locally" for uploads. Secrets live in the Doppler project `falsy-dev`.
