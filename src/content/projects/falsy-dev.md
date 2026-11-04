---
title: falsy.dev
order: 4
label: PRJ-04 / THIS SITE
line: This site, and the live Mars orbit behind it, rendered from real NASA data.
tags: [astro, three.js, webgpu, cloudflare]
status: Live, with the code on GitHub
stack: Astro on Cloudflare Workers, three.js with WebGPU (and a WebGL2 fallback), and terrain tiles in Cloudflare R2
link:
  href: https://github.com/RevOps-Rocks/falsy.dev
  text: github.com/RevOps-Rocks/falsy.dev
---

The background is a live render of Mars from a real orbit about 200 km up. The Sun is where it actually is right now, so the lighting and time of day match the real planet. The readout at the bottom shows where you are.

The terrain comes from NASA's Mars Global Surveyor elevation data and the Viking orbiter colour mosaic. I cut both into about 130,000 small tiles, and the page streams only the ones in view, usually a few megabytes. Relief is exaggerated 2.5× so the mountains stand out from this height.

It checks how fast your graphics card is and turns the quality down if it needs to. On phones, or with reduced motion turned on, you get a still image instead.
