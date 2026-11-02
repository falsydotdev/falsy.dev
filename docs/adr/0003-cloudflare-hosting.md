# 0003: Host on Cloudflare with assets in R2

Status: accepted, 2026-11-02

## Context

Each visitor who gets the live scene downloads tens of MB of terrain tiles. Vercel Pro's Flat Rate CDN terms exclude bulk file distribution and media-heavy bandwidth. The `falsy.dev` DNS is already on Cloudflare.

## Decision

- Serve the site from Cloudflare Workers static assets, using the Astro Cloudflare adapter.
- Serve tiles and textures from R2, on the same origin through a binding, or on a custom subdomain with caching rules. Never from `r2.dev`.

## Consequences

- R2 charges nothing for egress. Storage is $0.015 per GB-month.
- Same-origin assets avoid CORS friction, and COEP friction if we ever need `SharedArrayBuffer`.
- Tile files need content-hashed names, `Cache-Control: public, max-age=31536000, immutable`, and a Cache Everything rule for KTX2.
