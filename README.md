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
npm run data      # once: builds the prototype's Mars textures (about 31 MB from USGS) and links them into public/data
npm run dev
```

Then open http://localhost:4321. The live scene starts on desktop-width windows with WebGPU or WebGL2, and the poster shows until the first frame. `public/data` is an interim stand-in for the Phase 2 tile pipeline. It's gitignored and kept out of deploys by `public/.assetsignore`.

| Parameter | Effect |
|---|---|
| `live=1` / `live=0` | Force the live scene on or off, ignoring screen width and reduced motion |
| `shot=dawn-dusk`, `shot=orbital-sunrise`, `shot=feature-flyover` | Pick the orbit instead of a weighted random one |
| `t=N` | Preview at N× real time. The readout shows `t×N` whenever it isn't 1. |
| `alt=N` | Orbit altitude in km (120 to 2000, default 200). Orbital speed follows from it. |
| `tilt=N` | Degrees the camera looks below the horizon, beyond the geometric dip (default 12). Higher shows more ground moving. |
| `fov=N` | Vertical field of view in degrees (default 50). Narrower magnifies the motion. |
| `webgl` | Force the WebGL2 backend |

## Where things live

| Path | What |
|---|---|
| `src/config/brand.ts` | Consultancy name, URLs, booking link, and email. Rename the consultancy here. |
| `src/content/projects/` | One Markdown file per project. Front matter drives the card and the facts list. |
| `src/components/Stage.astro` | The persisted background: poster, sky grid, and telemetry readout. |
| `src/data/posters.json` | Poster metadata, written by the poster pipeline |
| `scripts/posters/` | Poster pipeline: `render.mjs` drives the prototype renderer, and `encode.mjs` writes AVIF files |
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
