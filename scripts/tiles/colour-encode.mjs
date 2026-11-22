// Colour tile encoding, shared by the cutter and the browser decode check so both use the bake's settings.
import { createRequire } from 'node:module';
import { TILES } from '../../src/scene/tiles/layout.ts';

const sharp = createRequire(import.meta.url)('sharp');
export const QUALITY = 60;

/** A sharp pipeline that encodes raw RGB or RGBA tile pixels as AVIF. */
export const encodeTile = (pixels, channels) => sharp(pixels, { raw: { width: TILES.colorPx, height: TILES.colorPx, channels } }).avif({ quality: QUALITY, effort: 4 });
