// The footer's data credits, by body. Build-time only: the page's scripts never import this, so
// the credits stay out of the JavaScript every visitor loads.
export const CREDITS: Record<string, string> = {
  mars: 'Mars terrain from USGS Astrogeology: MOLA elevation and the Viking MDIM 2.1 colour mosaic.',
  // The last sentence credits Earth's texture in the Moon's sky.
  moon: "Moon terrain from NASA/GSFC/Arizona State University: LOLA elevation, and LROC colour by NASA's Scientific Visualization Studio. Earth from NASA's Blue Marble, by the Scientific Visualization Studio.",
  // GEBCO's terms ask for the DOI and no suggestion of endorsement. Copernicus asks for "Contains
  // modified …" with the mosaic's year, which the bake takes as the year before it runs.
  earth:
    'Earth elevation from the GEBCO_2026 Grid (GEBCO Bathymetric Compilation Group 2026, doi:10.5285/4f68d5c7-45eb-f999-e063-7086abc036fa). Earth colour from Copernicus Sentinel-2 and NASA Blue Marble, and city lights from NASA Black Marble, by NASA Earth Observatory. Clouds from NOAA GMGSI (NESDIS). Contains modified Copernicus Sentinel data 2025.',
};

/** The credits for the bodies a visitor can reach (`listedBodyIds`). */
export const footerCredits = (ids: readonly string[]): string => ids.map((id) => CREDITS[id]).join(' ');
