# 0001: three.js WebGPU and TSL with a custom atmosphere

Status: accepted, 2026-11-02

## Context

The hero needs console-quality planetary rendering: physically based atmosphere, terrain shadows, and temporal accumulation. It also has to load after HTML-first content and degrade on weak devices. Later, the v2 explorer zooms across about 17 orders of magnitude. See [`../research/rendering-engine.md`](../research/rendering-engine.md).

## Decision

- Use three.js `WebGPURenderer`, writing shaders in TSL, its node-based shading language.
- Write our own Hillaire-style atmosphere, so it has per-planet parameters. Mars needs dust-dominated Mie scattering with per-channel phase asymmetry, and the Moon has no atmosphere.
- Build a floating origin and reversed depth from day one.

## Consequences

- The `prototypes/mars-orbit` prototype already runs on this stack at 60 fps on Apple silicon.
- Compute-based effects don't run on the WebGL2 backend, so there must be a degraded tier.
- `@takram/three-atmosphere` is Earth-only, so we don't use it. `@pmndrs/sky` is a reference for its LUT (lookup table) approach, not a dependency.
- We rejected Babylon.js, Cesium, Unity, and Godot. Each was too heavy, too tied to geospatial (GIS) use, or limited to WebGL2.
