# Planetary data research (2026-11-02)

Items marked UNVERIFIED are leads, not facts.

## Mars

| Asset | Source | Resolution | Size | License |
|---|---|---|---|---|
| Global color | [Viking MDIM 2.1 color](https://astrogeology.usgs.gov/search/map/mars_viking_colorized_global_mosaic_232m), `https://planetarymaps.usgs.gov/mosaic/Mars_Viking_MDIM21_ClrMosaic_global_232m.tif` | 232 m/px (92160×46080) | ~12 GB | Public domain |
| Global elevation | [MOLA 128 ppd](https://astrogeology.usgs.gov/search/map/mars_mgs_mola_dem_463m), `https://planetarymaps.usgs.gov/mosaic/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif` | 463 m/px (46080×23040, int16) | ~2 GB | CC0 |
| Regional elevation | MOLA-HRSC blend v2, `https://planetarymaps.usgs.gov/mosaic/Mars/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif` | 200 m/px | ~11 GB | HRSC part is CC BY-SA 3.0 IGO, so share-alike applies |
| Regional color | [Murray Lab CTX mosaic](https://murray-lab.caltech.edu/CTX/V01/tiles/) | 5 m/px, 4°×4° tiles | ~47k px per tile | Cite Dickson et al. 2024, DOI 10.1029/2024EA003555. Credit: NASA/JPL/MSSS/The Murray Lab |
| Stylized fallback | [Solar System Scope](https://www.solarsystemscope.com/textures/) 8k Mars | 8192×4096 | small | CC BY 4.0 |

- Olympus Mons is centered near 18.65°N, 226.2°E (UNVERIFIED).
- To avoid share-alike terms, crop the CC0 MOLA file rather than the HRSC blend.
- High-resolution strip elevation models from HRSC (up to 50 m) are in ESA's Planetary Science Archive and NASA's Planetary Data System (PDS). I found no pre-cut Olympus Mons tile.

## Moon

- NASA SVS [CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/):
  - `lroc_color_16bit_srgb_8k.tif`: 8192×4096, 232 MB.
  - `ldem_16_uint.tif`: 5760×2880, 31.7 MB. Values are uint16 in half-meters, offset by 20000.
  - `ldem_64_uint.tif`: 506 MB.
  - Credit: NASA's Scientific Visualization Studio.
- USGS LOLA elevation at 118 m (8 GB) and LROC WAC color at 100 m (5.5 GB), both public domain.

## Earth

- Solar System Scope 8k day, night, clouds, normal, and specular maps (CC BY 4.0).
- NASA Black Marble 2016 at 13500×6750, and Blue Marble Next Generation. Neither live link was confirmed.

## Jupiter and Saturn

- Jupiter: Cassini cylindrical map PIA07782 (3601×1801, NASA/JPL/SSI). Its license is unconfirmed.
- Björn Jónsson's maps: he asks for credit and no re-hosting.
- Solar System Scope 8k Jupiter, Saturn, and Saturn ring alpha maps (CC BY 4.0) are the permissive fallbacks.

## Ephemeris and orientation

- [astronomy-engine](https://github.com/cosinekitty/astronomy) `RotationAxis(body, date)` returns:
  - `ra` and `dec` of the north pole (J2000).
  - `spin`, the prime meridian angle.
  - `north`, a J2000 unit vector.
- It follows the IAU 2015 report and covers the Sun, Moon, all planets, and Pluto.
- Size is 41.5 kB gzipped.

## JPL "Visions of the Future" posters

- The [gallery](https://www.jpl.nasa.gov/galleries/visions-of-the-future) says the posters are "free for you to print", with credit "NASA/JPL-Caltech".
- Per NASA's [media guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/), use must not imply NASA endorsement, and third-party art needs the rights holder's permission.
- Avoid the Jupiter poster. It's based on a Ron Miller painting.
- I didn't read the JPL image-use policy page directly, because it returned a 404. Re-check before relying on it.
