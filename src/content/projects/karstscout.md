---
title: KarstScout
order: 1
label: PRJ-01 / GEOSPATIAL
line: Finds likely cave entrances in US LiDAR data.
tags: [python, pdal, sveltekit, maplibre]
status: Live, invite-only
stack: FastAPI, PDAL and rasterio on Railway, and SvelteKit with MapLibre and deck.gl on Cloudflare
---

KarstScout scans USGS 3DEP LiDAR for places where a cave entrance is likely. It runs these checks in order:

1. Masks for rock types where caves form.
2. Finds depressions in the ground.
3. Measures how open the terrain is.
4. Checks how deep each opening might go.
5. Scores a shortlist.

It favours precision over recall, so it only flags places it's fairly sure about.

I built it for my dad, who's a serious caver. It's invite-only for now, for a small group of cavers and geologists.
