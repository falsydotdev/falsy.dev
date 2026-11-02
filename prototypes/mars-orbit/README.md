# Mars orbit prototype

Throwaway prototype for the high-orbit vs close-up decision (Q8). It renders Mars with the real Sun position for the current time. The renderer is three.js WebGPU, and it falls back to WebGL2.

## Run it

```bash
npm install
npm run data   # range-reads the USGS GeoTIFFs into public/data (~31 MB, about 2 minutes)
npm run dev
```

## URL parameters

| Parameter | Effect |
|---|---|
| `mode=olympus` | Start in mode B, the Olympus Mons close-up |
| `exag=N` | Vertical exaggeration |
| `haze=N` | Dust haze density |
| `heading=N` | Camera direction relative to the Sun, in degrees |
| `hud=0` | Hide the HUD |
| `hero=0` | Hide the sample hero text |
| `webgl` | Force the WebGL2 backend |

The `alt`, `dist`, `lift`, and `orbitAlt` parameters tune the camera rig.

To publish as a Claude artifact, run `npx vite build && node scripts/build-artifact.mjs`.

## What's real

- **Sun direction:** computed with `astronomy-engine`, which uses the IAU 2015 rotation model for Mars.
- **Elevation:** MOLA 463 m/px, from USGS.
- **Color:** Viking MDIM 2.1, from USGS.
- **Close-up:** mode B opens at the next real sunrise over Olympus Mons.
- **Shadows:** raymarched through the height data.
- **Atmosphere:** single scattering, with dust-dominated Mie scattering.

## Known shortcuts

- The Viking mosaic has shading from the original photos baked into it, so some slopes look lit twice.
- Textures are JPEG and PNG, not KTX2. GPU memory is about 220 MB uncompressed. KTX2 would cut that 4 to 8 times.
- The star field is procedural, not a real catalogue.
- There's no temporal accumulation yet. That's the planned trick for heavier effects.
