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

Production builds read the tile base URL from `PUBLIC_TILES_URL` in `.env.production` (the R2 bucket at `tiles.falsy.dev`). `npm run tiles:upload` sends the tiles to R2, using credentials in `~/.config/falsy-dev/r2.env`.

| Parameter | Effect |
|---|---|
| `live=1` / `live=0` | Force the live scene on or off, ignoring screen width and reduced motion |
| `shot=dawn-dusk`, `shot=orbital-sunrise`, `shot=feature-flyover` | Pick the orbit instead of a weighted random one |
| `t=N` | Preview at N× real time. The readout shows `t×N` whenever it isn't 1. |
| `alt=N` | Orbit altitude in km (120 to 2000, default 200). Orbital speed follows from it. |
| `tilt=N` | Degrees the camera looks below the horizon, beyond the geometric dip (default 12). Higher shows more ground moving. |
| `fov=N` | Vertical field of view in degrees (default 50). Narrower magnifies the motion. |
| `far=N` | Distance in km beyond which terrain detail relaxes in proportion (default 500, `far=0` for full detail everywhere). The main lever on download size. |
| `webgl` | Force the WebGL2 backend |

## Where things live

| Path | What |
|---|---|
| `src/config/brand.ts` | Consultancy name, URLs, booking link, and email. Rename the consultancy here. |
| `src/content/projects/` | One Markdown file per project. Front matter drives the card and the facts list. |
| `src/components/Stage.astro` | The persisted background: poster, sky grid, and telemetry readout. |
| `src/data/posters.json` | Poster metadata, written by the poster pipeline |
| `scripts/posters/` | Poster pipeline: `render.mjs` drives the prototype renderer, and `encode.mjs` writes AVIF files |
| `src/scene/tiles/` | Cube-sphere tile addressing, LOD selection, and the tile file formats |
| `scripts/tiles/` | Tile pipeline: source download, height and colour cutters, budget estimate |
| `prototypes/mars-orbit/` | The Mars rendering prototype, which also renders the posters for now |
| `docs/` | Spec, plan, ADRs, research, copy, and design references |

## Posters

```bash
cd prototypes/mars-orbit && npm install && npm run data && cd ../..   # once, about 31 MB from USGS
node scripts/posters/render.mjs            # add --webgl to use SwiftShader, as CI does
node scripts/posters/encode.mjs posters-out/frames.json
```

Shots are defined in `scripts/posters/shots.json`. The Olympus Mons shot uses the most recent real sunrise there. The orbit shots use the current time.

## Deploy

Cloudflare Workers static assets, configured in `wrangler.jsonc`. CI deploys `main` once these are set on the repo:

- Secrets `CLOUDFLARE_API_TOKEN` (Workers Scripts edit, plus Workers Routes and DNS edit on the falsy.dev zone for the custom domain) and `CLOUDFLARE_ACCOUNT_ID`.
- Variable `DEPLOY_ENABLED=true`.
- Variable `POSTERS_ENABLED=true` turns on the daily poster re-render.

To deploy by hand: `npx wrangler login`, then `npm run deploy`.
