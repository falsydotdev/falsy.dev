# Rendering engine research (2026-11-02)

Items marked UNVERIFIED are leads, not facts.

## Recommendation

Use three.js `WebGPURenderer` with TSL (three.js's node-based shader language), a custom Hillaire-style atmosphere, and a custom terrain and level-of-detail (LOD) layer.

- **Renderer:** three.js r187 (2026-10-30) is active. Recent releases add WebGPU compute, reversed depth, and parallel pipeline compiles. `PostProcessing` was renamed `RenderPipeline` in r183. The WebGL2 fallback can't run compute-based features, so design a degraded tier.
- **Atmosphere:** `@takram/three-atmosphere` is "effectively limited to Earth's atmosphere", so don't use it for Mars. `@pmndrs/sky` is the better lead: WebGPU and TSL, three.js 0.186 or later, Earth, Mars, and Titan presets, and `planetCenter` for orbit views. It's low maturity, so plan to fork it.
- **Scale:** build a floating origin and scale hopping yourself. Study OpenSpace's scale graph.
- **Terrain:** quadtree chunked LOD with KTX2 textures. Cesium's Mars data (200 m elevation, 232 m imagery) is too coarse for low orbit, and it needs a paid commercial license.
- **Rejected:** Babylon (radius API undocumented), Unity 6.6 (heavy runtime), Godot (WebGL2 only), and a raw WebGPU engine (too much cost for little gain).
- **Temporal accumulation:** keep the scene mostly static and accumulate across frames, using jittered TAA (temporal anti-aliasing) and progressive refreshes of the cloud and atmosphere lookup tables (LUTs).
- **Browser support:** WebGPU ships in Chrome 113+, Safari 26, and Firefox 141+ on Windows. Many mobile and Linux paths are still partial.

## three.js WebGPURenderer and TSL

- Releases: r187 on 2026-10-30, r186 on 2026-09-24, r185 on 2026-07-01, and r184 on 2026-04-16. Source: https://github.com/mrdoob/three.js/releases
- r185 added WebXR on WebGPU, `storageTexture3D`, and surfaced uncaught GPU errors.
- r186 added `compileComputeAsync()` and DirectRenderPipeline.
- r187 added parallel `compileAsync()`, depth-only render targets, and cube render targets in PMREM (prefiltered environment maps). Logarithmic depth is ignored when reversed depth is on.
- The `PostProcessing` to `RenderPipeline` rename is in the [migration guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide).
- Blogs say `WebGPURenderer` has been the recommended renderer since about r182, with WebGL2 fallback. These are secondary sources.
- Compute passes don't run on the WebGL2 backend.
- Reversed depth helps precision, but 17 orders of magnitude still needs a floating origin and scale hopping.

## takram three-geospatial

- Repo: https://github.com/takram-design-engineering/three-geospatial. MIT license, about 1.8k stars.
- The repo README says a WebGPU rewrite is in progress (atmosphere done, clouds still in progress). The published 0.18.0 README says it has no TSL or WebGPU support. These conflict, and the conflict is unresolved.
- It's "effectively limited to Earth's atmosphere" and recommends Hillaire's method for other planets.
- Verdict: Mars would need a fork, and the clouds are built for Earth weather.

## Hillaire-style alternatives

- [@pmndrs/sky](https://github.com/pmndrs/sky):
  - WebGPU only, written in TSL.
  - Earth, Mars, and Titan presets, plus `planetCenter`.
  - Aerial perspective, a multi-scatter LUT, and a baked Milky Way.
  - No volumetric clouds.
  - 13 stars, so it's low maturity.
- JolifantoBambla/webgpu-sky-atmosphere: a raw WebGPU Hillaire implementation. Mars suitability is UNVERIFIED.
- Mars's atmosphere is dusty and dominated by Mie scattering, which gives its sunsets a blue glow. Hillaire's model can be parameterized for it. Coefficients are UNVERIFIED.

## Babylon.js

- The [atmosphere addon](https://doc.babylonjs.com/addons/atmosphere) is physically based. It supports orbital views on WebGPU or WebGL2 and exposes Rayleigh and Mie controls.
- No planet radius setting or floating origin is documented. It's a credible alternative, but the radius API is UNVERIFIED.

## Cesium

- [Cesium Mars](https://cesium.com/blog/2025/09/03/lift-off-to-cesium-mars/) is 3D Tiles: a MOLA-HRSC blended elevation model at 200 m and Viking color at 232 m, with higher resolution at Jezero and Gale.
- [Cesium Moon](https://cesium.com/platform/cesium-ion/content/cesium-moon/) is asset 2684829.
- The free tier is non-commercial, and commercial plans start at $149 a month ([pricing](https://cesium.com/platform/cesium-ion/pricing/)).
- It's heavy and built around geospatial (GIS) workflows. Use it as a data or format reference, not as the engine.

## Game engines

- **Unity 6.6:** WebGPU is out of experimental but opt-in, and the runtime is several MB ([docs](https://docs.unity3d.com/6000.6/Documentation/Manual/WebGPU-enable.html)).
- **Godot 4.5:** web exports are WebGL2 only, and one measured export was about 42 MB.
- **Unreal:** HTML5 export was removed (UNVERIFIED).
- Verdict: none of these suit a lightweight, HTML-first hero.

## References

- OpenSpace: an MIT-licensed native C++ app with a scale graph covering about 15 orders of magnitude and globe browsing. https://www.openspaceproject.com/features/globe-browsing.html
- NASA Eyes on the Solar System: current engine unconfirmed. A 2013 article says it used Unity.
- Bruneton precomputed scattering: https://github.com/ebruneton/precomputed_atmospheric_scattering

## WebGPU support

From [web.dev](https://web.dev/blog/webgpu-supported-major-browsers), 2025-11-25:

- Chrome and Edge 113+ on desktop, and Chrome 121+ on Android 12+.
- Firefox 141+ on Windows, and Firefox 145 on macOS Tahoe ARM64.
- Safari 26 on macOS and iOS.

Firefox on Linux and Android is still pre-release only. Check caniuse before shipping.

## Design guidance (not sourced)

- **Textures:** KTX2 with Basis compression, using UASTC for normal and height maps and ETC1S for color. Whether `KTX2Loader` works on `WebGPURenderer` is UNVERIFIED.
- **Hero terrain:** a pre-baked cubemap or a few high-resolution tiles on a displacement mesh is enough.
- **Explorer terrain:** a quadtree cube-sphere LOD with a KTX2 tile pyramid.
- **Temporal accumulation:**
  - Use jittered TAA with a long history window.
  - Spread cloud and LUT updates across many frames.
  - Re-bake the sky only when the Sun's angle changes.
  - Reset the history on camera cuts and scale hops.
- **Fallback tiers:** full WebGPU, then WebGL2 with pre-baked imagery, then a static poster.
