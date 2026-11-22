import { describe, expect, it } from 'vitest';
import { CREDITS, footerCredits } from '../../src/config/credits';
import { BODIES, listedBodyIds } from '../../src/scene/bodies';

const SHIPPED =
  "Mars terrain from USGS Astrogeology: MOLA elevation and the Viking MDIM 2.1 colour mosaic. Moon terrain from NASA/GSFC/Arizona State University: LOLA elevation, and LROC colour by NASA's Scientific Visualization Studio. Earth from NASA's Blue Marble, by the Scientific Visualization Studio.";

describe('footer credits', () => {
  it('keeps the shipped wording while Earth is unlisted', () => {
    expect(footerCredits(listedBodyIds(false))).toBe(SHIPPED);
  });

  it("credits every Earth source once Earth is listed, with GEBCO's DOI", () => {
    const credits = footerCredits(listedBodyIds(true));
    expect(credits.startsWith(SHIPPED)).toBe(true);
    for (const required of [
      'GEBCO_2026',
      'doi:10.5285/4f68d5c7-45eb-f999-e063-7086abc036fa',
      'Contains modified Copernicus Sentinel data 2025',
      'NASA Blue Marble',
      'NASA Black Marble',
      'NOAA GMGSI',
      'NESDIS',
    ]) {
      expect(credits).toContain(required);
    }
  });

  it("doesn't suggest that any source endorses the site", () => {
    expect(CREDITS.earth).not.toMatch(/endors|official|approv|partner|in association/i);
  });

  it('has a credit for every body', () => {
    for (const id of Object.keys(BODIES)) expect(CREDITS[id], id).toMatch(/\S/);
  });
});
