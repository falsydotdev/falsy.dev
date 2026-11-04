# 0004: Streaming terrain tiles everywhere

Status: accepted, 2026-11-02. Amended 2026-11-03 after the tile pipeline was built.

## Context

The prototype compared two modes:

- **Mode A:** one global texture set, at 4k height and 8k color.
- **Mode B:** a full-resolution regional crop around Olympus Mons.

Mode B looked far better, and Justin wants that quality for every random shot. Mode B's advantage came from data resolution (about 10× sharper), a lower camera, and relief exaggeration. None of these is specific to one region.

## Decision

- Cut each rocky body's full-resolution source data into a tile pyramid, offline. For Mars, that's MOLA 463 m elevation and Viking 232 m color.
- Use an equi-angular cube-sphere quadtree, levels 0 to 7. A level-7 tile is about 42 km across.
- Store the tiles in R2.
- Exaggerate relief 2.5× by default, and show it in the telemetry.

### Amended 2026-11-03

The original decision said KTX2, with UASTC for height and normal maps and ETC1S for color. Building it changed three things:

| Data | Original plan | Built | Why |
|---|---|---|---|
| Color | KTX2 ETC1S | AVIF, 256 px, quality 60 | On 16 Viking tiles, AVIF averaged 4 to 7 KB per tile at 37.5 to 39.8 dB PSNR. ETC1S needed 12 to 22 KB for 35.6 to 37.4 dB. Download size is the budget that matters; GPU memory isn't tight on the desktops that get the live scene. |
| Height | KTX2 UASTC | Custom: 99×99 samples in 2 m steps, gradient-predicted, gzip | UASTC is lossy block compression. A 16-bit height split across two 8-bit channels breaks when the low byte takes block errors. The custom format is lossless at 2 m and averages about 3 KB per tile. |
| Normals | Precomputed pyramid at 2.5× relief | Computed in the shader from the height tile | Saves a whole pyramid of downloads, and relief can change at runtime. |

Other details:

- Height tiles use 96 cells, so full-resolution samples are 434 m apart, matching MOLA's 463 m. They're corner-aligned with a one-sample border, so neighbouring tiles agree on edges and normals difference cleanly up to the edge.
- Long shadows march through one coarse global height map (2048×1024, about 10 km per sample, 1.2 MB). The march starts from that same map, so the surface never shadows itself.
- The renderer draws every visible tile in one instanced call. Colour and height tiles live in two array textures (512 layers when the GPU allows it). A tile that is still loading borrows its nearest loaded ancestor's texels.
- Each tile's parent is fetched along with it, so the fallback is never more than one level coarser.

## Consequences

- A typical view should load about 10 to 20 MB of tiles. That budget is a Phase 2 acceptance check. `scripts/tiles/budget.mjs` measures it by replaying real orbits through the renderer's own selection and fetch code.
- The colour atlas uses about 180 MB of GPU memory at 512 layers. If that's too much for mid-range laptops, transcoding AVIF to BC1 in the tile worker would cut it 8×.
- The source mosaics (15 GB) and baked tiles (about 2 GB, about 260,000 files) live in `~/.cache/falsy-dev`, outside the repo. There are too many files for Workers static assets, so production serves them from R2.
- The same tile system is the foundation for the v2 explorer's continuous zoom.
