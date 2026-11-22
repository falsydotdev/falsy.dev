---
title: falsy.dev
order: 4
label: PRJ-04 / THIS SITE
line: This site, and the live orbit of Mars, the Moon or Earth behind it, rendered from real data.
tags: [astro, three.js, webgpu, cloudflare]
status: Live, with the code on GitHub
stack: Astro on Cloudflare Workers, three.js with WebGPU (and a WebGL2 fallback), and terrain tiles in Cloudflare R2
link:
  href: https://github.com/falsydotdev/falsy.dev
  text: github.com/falsydotdev/falsy.dev
---

The background is a live render of Mars, the Moon or Earth from a real orbit, about 200 km up over Mars, 100 km over the Moon and 400 km over Earth. The Sun is where it actually is right now, so the lighting and time of day match the real planet. The readout at the bottom shows where you are.

The terrain comes from NASA data: Mars Global Surveyor elevation and the Viking colour mosaic for Mars, and Lunar Reconnaissance Orbiter elevation and colour for the Moon. Earth uses GEBCO elevation, Copernicus Sentinel-2 and NASA Blue Marble colour, and NASA Black Marble city lights. Its clouds come from NOAA satellite images, updated every three hours. I cut each into about 130,000 small tiles, and the page streams only the ones in view, usually a few megabytes. Relief is exaggerated 2.5× so the mountains stand out from this height.

It checks how fast your graphics card is and turns the quality down if it needs to. On phones, or with reduced motion turned on, you get a still image instead.
