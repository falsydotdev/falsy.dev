import { homedir } from 'node:os';
import { join } from 'node:path';
import { BODIES, EARTH_RADIUS_KM, EARTH_TILES } from '../../src/scene/bodies.ts';
import { QUAD_TILES } from './earth/grid.ts';
import { bmngMonth } from './earth/sentinel.ts';

// Source mosaics and baked tiles are tens of GB, so they live outside the repo (and outside worktrees).
export const DATA_DIR = process.env.FALSY_DATA_DIR ?? join(homedir(), '.cache', 'falsy-dev');
export const SOURCE_DIR = join(DATA_DIR, 'sources');
export const TILE_DIR = join(DATA_DIR, 'tiles');
/** Global (or boxed) rasters that the Earth mosaic step assembles from tiled sources. */
export const MOSAIC_DIR = join(SOURCE_DIR, 'earth-mosaic');

/** Picks the Sentinel-2 quarter and the Blue Marble month; set EARTH_BAKE_DATE to re-bake a past season. */
export const EARTH_BAKE_DATE = new Date(process.env.EARTH_BAKE_DATE ?? Date.now());
const BMNG = bmngMonth(EARTH_BAKE_DATE);
const GEBCO_URL = 'https://dap.ceda.ac.uk/bodc/gebco/global/gebco_2026/ice_surface_elevation/geotiff';
const BMNG_URL = `https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-base/${BMNG.name}`;
const range = (t) => `n${t.north.toFixed(1)}_s${t.south.toFixed(1)}_w${t.west.toFixed(1)}_e${t.east.toFixed(1)}`;
const earthSources = Object.fromEntries(
  QUAD_TILES.flatMap((t) => [
    // GEBCO_2026 ice surface (not sub-ice, which puts the ice sheets below sea level): 21600² int16, uncompressed.
    [`gebco${t.name}`, { url: `${GEBCO_URL}/gebco_2026_${range(t)}_geotiff.tif`, file: join(SOURCE_DIR, 'earth', `gebco_2026_${range(t)}_geotiff.tif`), tile: t }],
    // Blue Marble Next Generation base map (no hillshade), 500 m.
    [`bmng${t.name}`, { url: `${BMNG_URL}/world.${BMNG.stamp}.3x21600x21600.${t.name}.jpg`, file: join(SOURCE_DIR, 'earth', `world.${BMNG.stamp}.3x21600x21600.${t.name}.jpg`), tile: t }],
  ]),
);

export const SOURCES = {
  mola: {
    url: 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif',
    file: join(SOURCE_DIR, 'Mars_MGS_MOLA_DEM_mosaic_global_463m.tif'),
  },
  viking: {
    url: 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars_Viking_MDIM21_ClrMosaic_global_232m.tif',
    file: join(SOURCE_DIR, 'Mars_Viking_MDIM21_ClrMosaic_global_232m.tif'),
  },
  // LOLA gridded heights: raw little-endian int16 in half-metre steps, columns from 0°E (see the .lbl).
  lola: {
    url: 'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_128.img',
    file: join(SOURCE_DIR, 'ldem_128.img'),
  },
  lolaLabel: {
    url: 'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_128.lbl',
    file: join(SOURCE_DIR, 'ldem_128.lbl'),
  },
  // NASA SVS CGI Moon Kit colour (2025), 16-bit sRGB, columns from 180°W.
  lroc: {
    url: 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_16bit_srgb_16k.tif',
    file: join(SOURCE_DIR, 'lroc_color_16bit_srgb_16k.tif'),
  },
  ...earthSources,
  naturalEarthLand: {
    url: 'https://naciscdn.org/naturalearth/10m/physical/ne_10m_land.zip',
    file: join(SOURCE_DIR, 'earth', 'ne_10m_land.zip'),
  },
  // Coarse global fill for test bakes: GEBCO every 20th sample (1/12°) over OPeNDAP, Blue Marble at 8 km.
  gebcoCoarse: {
    url: 'https://dap.ceda.ac.uk/thredds/dodsC/bodc/gebco/global/gebco_2026/ice_surface_elevation/netcdf/GEBCO_2026.nc.dods?elevation.elevation%5B10:20:43199%5D%5B10:20:86399%5D',
    file: join(SOURCE_DIR, 'earth', 'gebco_2026_every20.dods'),
    whole: true,
  },
  bmngCoarse: {
    url: `${BMNG_URL}/world.${BMNG.stamp}.3x5400x2700.jpg`,
    file: join(SOURCE_DIR, 'earth', `world.${BMNG.stamp}.3x5400x2700.jpg`),
  },
};

// Which sources make each body's tiles, and how to read them. Height `pixelM` picks the mip a
// tile samples from.
export const PIPELINE = {
  mars: {
    heights: { source: 'mola', format: 'geotiff-int16', pixelM: 463.0935, nodata: -32768 },
    colour: { source: 'viking', format: 'planar-strips' },
  },
  moon: {
    heights: { source: 'lola', label: 'lolaLabel', format: 'pds-int16', pixelM: 236.901 },
    colour: { source: 'lroc', format: 'decode' },
  },
  // Earth's sources ship as tiles, so a mosaic step assembles them into rasters under MOSAIC_DIR
  // first (heights at 1/120°, mask and colour at 1/240°), and the cutters read those.
  earth: {
    heights: { format: 'mosaic' },
    colour: { format: 'mosaic' },
    fetch: [...QUAD_TILES.flatMap((t) => [`gebco${t.name}`, `bmng${t.name}`]), 'naturalEarthLand'],
    steps: ['fetch-sources', 'earth-mosaic', 'earth-sentinel', 'heights', 'colour'],
  },
};

/** Radius and tile layers for a body's bake, including Earth before it joins BODIES. */
export function bodyInfo(id) {
  const body = BODIES[id];
  if (body) return { radiusKm: body.radiusKm, layers: body.tiles.layers };
  if (id === 'earth') return { radiusKm: EARTH_RADIUS_KM, layers: EARTH_TILES.layers };
  throw new Error(`No body config for ${id}`);
}

/** The `--body <id>` argument, defaulting to Mars. */
export function bodyArg() {
  const i = process.argv.indexOf('--body');
  const id = i > 0 ? process.argv[i + 1] : 'mars';
  if (!PIPELINE[id]) throw new Error(`Unknown body ${id}; expected one of ${Object.keys(PIPELINE).join(', ')}`);
  return id;
}
