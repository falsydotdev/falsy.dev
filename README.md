# falsy.dev

Justin Powell's portfolio and consulting site, with a planet rendered from real data behind the content. The spec is in [`docs/SPEC.md`](docs/SPEC.md), and the phased plan is in [`docs/PLAN.md`](docs/PLAN.md).

## Run it

```bash
npm install
npm run dev       # http://localhost:4321
npm run build     # static site in dist/
npm run preview
```

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
