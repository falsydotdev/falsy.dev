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
};
