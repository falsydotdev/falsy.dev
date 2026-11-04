# 0002: Astro with a persisted canvas

Status: accepted, 2026-11-02. The persistence spike passed on 2026-11-02.

## Context

The site is mostly static content, plus one heavy canvas. The planet has to keep rendering while visitors move between pages, and content pages should ship as little JavaScript as possible. See [`../research/framework-hosting.md`](../research/framework-hosting.md).

## Decision

- Use Astro, with content collections for the projects.
- Put the stage element (poster plus canvas) in the shared layout, marked `transition:persist="stage"`, under `<ClientRouter />`.
- Start the renderer from a bundled module script in the layout. Bundled module scripts run once per full page load, so client-side navigation never starts a second renderer.

## Spike result

Tested on Astro 7.4.2 and three.js r186 in Chromium, with the WebGPU backend, against a production build (`astro build` then `astro preview`):

| Check | Result |
|---|---|
| Canvas element after 3 link navigations and 1 back navigation | Same element, same marker attribute |
| Canvases in the document | Always 1 |
| `renderer.init()` calls | 1 |
| Frames rendered during navigation | Kept counting at about 60 fps |

The spike pages were removed once the real layout replaced them.

## Consequences

- Content pages ship no JavaScript of their own, which keeps the under-one-second rule easy.
- The SvelteKit fallback isn't needed.
- Anything inside the stage, including the poster image, is also kept across navigation, so the poster never flashes or reloads.
