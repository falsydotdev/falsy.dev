# falsy.dev

Justin Powell's portfolio site: Astro pages over a live three.js planet scene (WebGPU, with a WebGL2 fallback), served by Cloudflare Workers. The README covers setup, URL preview parameters, posters, and deploys. `docs/SPEC.md` holds the what and why. Read the matching ADR in `docs/adr/` before changing the rendering stack, page persistence, hosting, terrain streaming, or the clock.

## Verify a change

CI runs these in order. Run the same before you push:

```bash
npx astro check
npm test
npx astro build
node scripts/check-html-size.mjs
```

- Inside `.claude/worktrees/`, Astro fails with "Tsconfig not found astro/tsconfigs/strict". Copy the worktree outside the repo without `node_modules`, run `npm ci`, and run the steps there.
- Lighthouse CI then enforces the mobile budgets in `lighthouserc.json`. Anything that adds weight before first paint can fail CI after the steps above pass.
- Each page's gzipped HTML must stay under 13,600 bytes so it fits the first round trip. Stylesheets are inlined (`inlineStylesheets: 'always'`), so CSS counts against it.
- Unit tests cover the scene's math (orbits, tiles, composition, quality tiers), not its pixels. Check live-scene changes in a browser.

## Invariants

- Page content renders without the scene. The poster shows first and the live scene fades in over it.
- Visitors see the real clock (ADR 0005): the Sun and planet are where they are right now, and motion comes from the camera's real orbit. `t=` and `at=` are preview parameters only.
- Per-body values (radius, orbit, lighting, features) live in `src/scene/bodies.ts`. Renderer code reads them from there.
- The consultancy name may change. Read names, URLs, and contact details from `src/config/brand.ts`.
- Site copy is written in Justin's voice with the `sound-like-justin` skill, and Justin approves it before it merges.

## Environment gotchas

- The tile pipeline (`npm run tiles*`) downloads about 15 GB for Mars and 3 GB for the Moon. Run it only when Justin asks.
- In development, the live scene loads tiles from `~/.cache/falsy-dev`, not from production. Without local tiles, work against posters (`?live=0`).
- Analytics run only through the Worker's `/uplink` relay. The README's `ph=1` row explains how to test them.

## Git and pull requests

- Every push to `main` deploys production through Cloudflare Workers Builds. Work on a branch and open a PR.
- Before you propose a merge, run `/code-review` until a pass has no important findings on common paths. List rare edge cases and pre-existing issues for Justin instead of chasing them. Merge only with Justin's OK.
- Write commit subjects in sentence case and the imperative mood, with no type prefix: "Cap the load clock's step".
- This repo is public. Keep account IDs, analytics project details, and other infrastructure identifiers out of code, commits, and PR text. The PostHog token in `.env.production` is public by design.

## Agent skills

### Issue tracker

Issues and specs live in this repo's GitHub Issues, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage labels, each named for its role (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
