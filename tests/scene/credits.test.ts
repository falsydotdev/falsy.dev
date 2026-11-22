import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CREDITS, earthCredit, footerCredits } from '../../src/config/credits';
import { BODIES, EARTH } from '../../src/scene/bodies';
import { colorPeriod, copernicusYear } from '../../scripts/tiles/earth/sentinel.ts';

const SHIPPED =
  "Mars terrain from USGS Astrogeology: MOLA elevation and the Viking MDIM 2.1 colour mosaic. Moon terrain from NASA/GSFC/Arizona State University: LOLA elevation, and LROC colour by NASA's Scientific Visualization Studio. Earth from NASA's Blue Marble, by the Scientific Visualization Studio.";

describe('footer credits', () => {
  it('keeps the shipped wording while Earth is unlisted', () => {
    expect(footerCredits(['mars', 'moon'])).toBe(SHIPPED);
  });

  it("credits every Earth source once Earth is listed, with GEBCO's DOI", () => {
    const credits = footerCredits(['mars', 'moon', 'earth']);
    expect(credits.startsWith(SHIPPED)).toBe(true);
    expect(credits.endsWith(earthCredit(EARTH.tiles.sentinelYear ?? null))).toBe(true);
    for (const required of [
      'GEBCO_2026',
      'doi:10.5285/4f68d5c7-45eb-f999-e063-7086abc036fa',
      'NASA Blue Marble',
      'NASA Black Marble',
      'NOAA GMGSI',
      'NESDIS',
    ]) {
      expect(credits).toContain(required);
    }
  });

  it("credits Copernicus with the year of the Sentinel-2 mosaic the bake used", () => {
    expect(earthCredit(2025)).toContain('Earth colour from Copernicus Sentinel-2 and NASA Blue Marble');
    expect(earthCredit(2025)).toMatch(/Contains modified Copernicus Sentinel data 2025\.$/);
    expect(earthCredit(2026)).toMatch(/Contains modified Copernicus Sentinel data 2026\.$/);
  });

  it('leaves Copernicus out of a Blue Marble-only bake', () => {
    expect(earthCredit(null)).toContain('Earth colour from NASA Blue Marble, and city lights');
    expect(earthCredit(null)).not.toMatch(/Copernicus|Sentinel/);
  });

  it("names the year the bake's colour period records", () => {
    const bake = new Date('2026-11-23T00:00:00Z');
    expect(copernicusYear(colorPeriod(bake, 12_345))).toBe(2025);
    expect(copernicusYear(colorPeriod(bake, 0))).toBeNull();
    expect(copernicusYear(undefined)).toBeNull();
  });

  // The tiles live outside the repo, so this runs only where a local Earth bake exists.
  const bakeMeta = join(process.env.FALSY_DATA_DIR ?? join(homedir(), '.cache', 'falsy-dev'), 'tiles', 'earth', 'meta.json');
  it.skipIf(!existsSync(bakeMeta))("matches the local Earth bake's colour period", () => {
    const { colorPeriod: period } = JSON.parse(readFileSync(bakeMeta, 'utf8'));
    expect(EARTH.tiles.sentinelYear ?? null).toBe(copernicusYear(period));
  });

  it("doesn't suggest that any source endorses the site", () => {
    expect(CREDITS.earth).not.toMatch(/endors|official|approv|partner|in association/i);
  });

  it('has a credit for every body', () => {
    for (const id of Object.keys(BODIES)) expect(CREDITS[id], id).toMatch(/\S/);
  });

  it('fails the build rather than ship a footer missing a body', () => {
    expect(() => footerCredits(['mars', 'pluto'])).toThrow(/pluto/);
  });
});
