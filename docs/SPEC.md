# falsy.dev v1 specification

Status: agreed 2026-11-02. Architecture decisions are in [`adr/`](adr/), and the phased build is in [`PLAN.md`](PLAN.md).

## Purpose

falsy.dev is Justin Powell's personal portfolio. He's a solo builder who isn't a trained developer but builds software most days with AI. The page shows his projects first and his GTM engineering and RevOps consulting second (reframed 2026-11-03; it was consulting-first). The live planetary background is the signature. It shows the engineering standard of the work without getting in the way of the content.

## Audience

1. **People curious about what Justin builds:** peers, users of his apps, and collaborators. They look at the projects, the repo, and the easter egg.
2. **Consulting buyers:** revenue and operations leaders who might hire Justin. They need the offer, proof, and a way to book a call.

## Hard rules

- Text and links are readable and usable in under one second, with no dependence on the 3D scene.
- The 3D scene loads after the content and never blocks it. Heavy assets never block anything.
- Rendering pauses when the tab is hidden or the hero is scrolled out of view.
- Visitors with reduced motion turned on get a still camera.
- Everything the scene presents as real is real: Sun position, rotation, orbital motion, terrain data, and (for Earth) clouds. Any departure, such as relief exaggeration, is labelled in the telemetry readout.

## Brand

- falsy.dev lives under the RevOps-Rocks GitHub organization.
- The consulting section presents RevOps Rocks as the company you hire.
- The consulting brand's name, logo, and links live in one config file. A rename from RevOps Rocks to falsy should be a one-line change plus redirects.
- The name means Justin is a "falsy" developer: in JavaScript, a falsy value acts false without actually being false. About explains it in one line. Light wordplay on the void and `null` is fine in the 404 page, loading text, and the explorer's edge-of-universe message. Never in the headline.

## Content

### Home page

One short scroll:

1. Hero: location, name, and one-line positioning. No buttons, only a quiet scroll cue (2026-11-03). Booking lives in Consulting and Contact.
2. Selected projects.
3. Consulting: the offer, outcomes, and the booking link.
4. About: from physics to RevOps.
5. Contact.

### Project pages

Each project gets a detail page, with the planet persisting in the background as visitors navigate. Launch projects:

- KarstScout
- stipendium
- RevOps Roles

### Contact

- The primary call to action links out to Justin's HubSpot meetings page. It isn't embedded, because HubSpot's embed scripts are heavy.
- Email appears as plain, selectable text.
- An optional short "tell me about your project" form posts straight to the HubSpot Forms API.

### Out of scope at launch

A blog or writing section. Astro content collections make it easy to add later.

### Copy

Claude drafts all copy in Justin's voice with the `sound-like-justin` skill, and Justin edits.

## Visual design

- Clean editorial typography with plenty of space, plus a thin layer of sci-fi detail: the telemetry readout, monospace labels, and fine grid lines.
- Text stays readable through composition first. Each shot keeps the planet clear of the text column.
- Where text crosses the planet, such as project cards scrolling over it, a glass panel sits behind the text. The renderer draws that glass itself, because it already knows where the text boxes are. Fallback visitors get a CSS blur over the poster.
- **Design system: Direction D (Blue Hour × Flight Dynamics)**, chosen 2026-11-02. See [`design/directions.html`](design/directions.html).

### Direction D

| Role | Face | Used for |
|---|---|---|
| Display | Instrument Serif | Name, section titles, and project names. Italics for emphasis. |
| Body | IBM Plex Sans | Running text and descriptions. Replaced Instrument Sans on 2026-11-03 (see `design/body-fonts.html`). |
| Data | Martian Mono | Telemetry, nav, labels, tags, and buttons |

| Token | Value | Notes |
|---|---|---|
| Ink | `#eef1f4` | |
| Muted ink | `rgba(220, 228, 236, 0.7)` | |
| Accent | `#9cc6ec` | The Martian-sunset blue. It's the only accent, because it stays readable over orange terrain and grey regolith. |
| Glass | `rgba(10, 16, 26, 0.46)`, with a 1px border at 24% accent | Card corners get an accent bracket. |

- **Screen grid:** a coordinate grid in the empty sky, at 12% accent, fading out before the planet.
- **No grid on the planet:** a latitude and longitude graticule was prototyped and rejected.
- **Buttons:** rectangular and monospace, with an arrow.
- **Nav:** each item is prefixed with an accent `/`.

## Hero scene

### Bodies

| Release | Bodies |
|---|---|
| v1 launch | Mars and the Moon, which share the rocky terrain pipeline |
| v1.x | Earth, then Jupiter, then Saturn, each its own release |

Each load picks a body, with weights favoring the most striking ones. The site never shows the same body twice in a row for one visitor, using browser storage that tolerates being empty.

### Shots

The camera rides a real low orbit at real orbital speed. For Mars at 200 km (the default since 2026-11-03), that's 3.45 km/s, with one orbit taking 1.82 hours. Mars turns underneath, so each orbit's ground track lands about 27° of longitude west of the last. Each load picks one of three orbits:

- **Dawn-dusk orbit:** an orbit whose plane is perpendicular to the Sun line, so it rides the terminator. It gives long shadows on the day-night line. It isn't a true sun-synchronous orbit, which at this altitude needs an inclination of about 93° and relies on Mars' J2 oblateness. Over a visit of minutes the two look the same, and the readout never claims sun-synchronous.
- **Orbital sunrise:** an orbit that crosses the terminator. The camera starts about a minute before orbital sunrise, on the night side, with the Sun behind the planet. The atmosphere's rim glows, and light shafts fan through the dust before the Sun breaks the limb. Bodies without an atmosphere, like the Moon, get a hard-edged sunrise with no glow.
- **Feature flyover:** an orbit whose ground track passes over a named feature from the body's list (for example, Olympus Mons, Valles Marineris, Gale Crater, or Tycho) that currently has a low Sun. If no listed feature is well lit, it falls back to a dawn-dusk orbit.

Choosing the orbit and where the camera starts on it is a camera choice. The clock is never shifted.

Composition rules:

- The horizon sits in the upper part of the frame.
- Dark space stays behind the text column.
- The Sun stays out of frame by default. Strong forward scattering from Martian dust washes out the terrain when the camera looks into the Sun. The orbital sunrise shot is the exception: the Sun sits behind the planet's limb.

### Time and motion

- The clock is always real time, so the lighting is where the Sun is right now.
- Motion comes from the camera's real orbital velocity, propagated as a circular two-body orbit.
- Reduced-motion visitors get a still camera at the chosen starting point.

### Fidelity

- **Terrain:** streaming terrain tiles give close-up quality everywhere. The tiles are a pyramid cut from the USGS and NASA source data, compressed to KTX2, and served from R2. Level of detail (LOD) is a quadtree on a cube-sphere.
- **Relief:** height is exaggerated 2.5× by default on rocky bodies. The telemetry says so, for example `RELIEF ×2.5`.
- **Shadows:** terrain shadows are raymarched through the height data.
- **Atmosphere:** Hillaire-style physically based scattering, with dust-dominated Mie scattering for Mars and no atmosphere for the Moon. It includes light shafts (volumetric shadowing) for the orbital sunrise shot.
- **Heavy effects:** these use temporal accumulation, because the scene changes slowly.
- **Scale:** the renderer uses a floating origin and reversed depth from day one, so the v2 zoom across 17 orders of magnitude works without a rewrite.

### Telemetry readout

The readout sits in a corner, for example `MARS  18.4°N  226.0°E  LST 06:12  ALT 200 km  v 3.45 km/s  relief×2.5`. It shows real values for the current shot. Clicking it starts the explorer. A keyboard sequence also starts the explorer.

### Fallback poster

- A still frame of our own scene, re-rendered daily by an automated job. It loads instantly and fades into the live scene on capable devices.
- While a poster shows, the telemetry readout describes that frame and ends with `still DD MON HH:MM UTC`, the moment its lighting was computed for. That keeps the readout true when the frame isn't live.
- Phones, low-power devices, devices without WebGPU or WebGL2, and reduced-motion visitors keep the poster.
- The live scene picks a quality tier from the measured frame rate.

### Later bodies

- **Earth:** shows that day's real clouds from NASA's daily imagery, fetched by the daily job. It falls back to the previous day, then to a static cloud map. Night-side city lights come from NASA Black Marble.
- **Jupiter and Saturn:** cloud bands drift at their real, latitude-dependent rotation rates, using Cassini and Juno maps with flow distortion. At real time that drift is slow, so the camera's orbit carries the motion. Saturn's rings and the planet shadow each other.

## Easter egg: the explorer (v2)

- The explorer is the same live scene, not a separate page. The content fades out, and the camera unlocks and pulls back through the solar system, the Milky Way, and the Local Group.
- Ambient sound plays in the explorer only, and stays off until the visitor turns it on.
- In v1, projects stay ordinary page content. They don't appear as objects in the universe.
- The explorer gets its own grilling session after v1 ships.

## Stack

| Concern | Choice | ADR |
|---|---|---|
| Rendering | three.js `WebGPURenderer` and TSL, with a WebGL2 fallback tier | [0001](adr/0001-rendering-stack.md) |
| Framework | Astro, with the canvas persisted across navigation | [0002](adr/0002-astro-persisted-canvas.md) |
| Hosting | Cloudflare Workers static assets, with R2 for tiles and textures | [0003](adr/0003-cloudflare-hosting.md) |
| Terrain | Streaming tile pyramid with quadtree LOD | [0004](adr/0004-streaming-terrain.md) |
| Ephemeris and camera | `astronomy-engine` (IAU 2015 rotation models), with real-time lighting and a real orbit | [0005](adr/0005-real-time-real-orbit.md) |
| Analytics | PostHog in cookieless mode | — |
| Booking | HubSpot meetings link, plus the HubSpot Forms API | — |

The DNS for `falsy.dev` is already on Cloudflare.

## Analytics

PostHog in cookieless mode tracks:

- Page views
- Booking clicks
- Form submissions
- Easter-egg discovery rate, which shows whether the telemetry trigger is too hidden
- Live-scene quality tier, to see what devices actually get

## Repository

- `RevOps-Rocks/falsy.dev`. It's private until launch, then goes public.
- Secrets live only in Cloudflare and GitHub environment settings.

## Data credits

Credits appear in the about page or the footer:

- **USGS Astrogeology:** MOLA elevation and the Viking MDIM 2.1 color mosaic.
- **NASA SVS:** the CGI Moon Kit.
- **Murray Lab:** the CTX mosaic, if it's used.
- **NASA/JPL-Caltech:** for any posters used. Use must not imply NASA endorsement. Avoid the Jupiter "Visions of the Future" poster, which is a third-party painting.

## Known issues to solve

- **Baked shading:** the Viking color mosaic has shading from the original photos baked in, so some slopes look lit twice. Evaluate de-shading the mosaic, or using another color source, during Phase 2.
- **Persisted canvas:** resolved. The Phase 1 spike showed a WebGPU canvas surviving navigation under `transition:persist` (ADR 0002).
- **Payload:** the prototype downloads about 20 MB for mode A and 31 MB with the close-up, as unoptimized PNG and JPEG. Its GPU textures take about 220 MB uncompressed. KTX2 compression and tiling must bring a typical view under the Phase 2 budget.
