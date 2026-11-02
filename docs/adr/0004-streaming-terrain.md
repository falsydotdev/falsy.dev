# 0004: Streaming terrain tiles everywhere

Status: accepted, 2026-11-02

## Context

The prototype compared two modes:

- **Mode A:** one global texture set, at 4k height and 8k color.
- **Mode B:** a full-resolution regional crop around Olympus Mons.

Mode B looked far better, and Justin wants that quality for every random shot. Mode B's advantage came from data resolution (about 10× sharper), a lower camera, and relief exaggeration. None of these is specific to one region.

## Decision

- Cut each rocky body's full-resolution source data into a tile pyramid, offline. For Mars, that's MOLA 463 m elevation and Viking 232 m color.
- Encode the tiles as KTX2, with UASTC for height and normal maps and ETC1S for color.
- Store the tiles in R2.
- Render with quadtree LOD on a cube-sphere.
- Exaggerate relief 2.5× by default, and show it in the telemetry.

## Consequences

- A typical view should load about 10 to 20 MB of tiles. That budget is a Phase 2 acceptance check.
- The pipeline extends the prototype's `build-data.mjs`, which already range-reads the USGS GeoTIFFs without downloading them in full.
- The same tile system is the foundation for the v2 explorer's continuous zoom.
- Height-texture shadows must sample the same tiles the surface uses, or the coarse mesh self-shadows along triangle edges. The prototype already hit this.
