# 0002: Astro with a persisted canvas island

Status: accepted, 2026-11-02 (subject to the persistence spike)

## Context

The site is mostly static content, plus one heavy canvas. The planet has to keep rendering while visitors move between pages, and content pages should ship as little JavaScript as possible. See [`../research/framework-hosting.md`](../research/framework-hosting.md).

## Decision

- Use Astro, with content collections for the projects.
- Mount the canvas once, in the shared layout, as an island with `transition:persist` under `<ClientRouter />`.

## Consequences

- Content pages ship zero JavaScript by default, which keeps the under-one-second rule easy.
- Astro doesn't document whether a WebGPU canvas survives persistence. Spike it first in Phase 1. If it fails, fall back to SvelteKit with the canvas in the root layout.
