import { homedir } from 'node:os';
import { join } from 'node:path';

// Source mosaics and baked tiles are tens of GB, so they live outside the repo (and outside worktrees).
export const DATA_DIR = process.env.FALSY_DATA_DIR ?? join(homedir(), '.cache', 'falsy-dev');
export const SOURCE_DIR = join(DATA_DIR, 'sources');
export const TILE_DIR = join(DATA_DIR, 'tiles');

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
};

/** The `--body <id>` argument, defaulting to Mars. */
export function bodyArg() {
  const i = process.argv.indexOf('--body');
  const id = i > 0 ? process.argv[i + 1] : 'mars';
  if (!PIPELINE[id]) throw new Error(`Unknown body ${id}; expected one of ${Object.keys(PIPELINE).join(', ')}`);
  return id;
}
