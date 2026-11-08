# falsy.dev copy draft (v1)

This is a first draft in Justin's voice for him to edit. It follows the `sound-like-justin` rules: first person, sentence case, no em dashes, and Australian spelling. Facts come from the RevOpsRocks, RevOpsRoles, stipendium, and KarstScout repos, plus Justin's answers below.

## Answered questions (2026-11-02)

1. **Education:** four years of physics, one at the University of Arizona and three at the University of Utah. Graduated with a degree in economics and a minor in physics.
2. **Magnific:** name it. It's already public on LinkedIn.
3. **RevOps Roles:** checks more than 50,000 sources. No user count.
4. **KarstScout:** mentioning that it was built for Justin's dad is fine.
5. **Reply promise:** "within one business day" stays.

## Phase 1 changes waiting for Justin's approval

Phase 1 ships with poster stills, not the live scene, so two lines that claim "live" or "right now" would be false until Phase 2. The site uses the "after" text for now. Phase 2 switches back to the approved text.

| Spot | Before (approved) | After (Phase 1) | Why |
|---|---|---|---|
| About, paragraph 3 | (Replaced 2026-11-04, see About below.) | | Phase 2 shows the live scene on computers and stills on phones, so the paragraph now covers both. |
| Meta description | …and a live view of Mars. | …and a view of Mars rendered from real data. | Same reason |

## Meta

- **Title:** Justin Powell · falsy.dev
- **Description:** I'm not a trained developer, but I spend most days building software with AI. Here are my projects, my consulting work through RevOps Rocks, and a view of Mars or the Moon rendered from real data.

## Hero

- **Eyebrow:** Adelaide · 34.9°S 138.6°E
- **Headline:** Justin *Powell*
- **Line:** I'm not a trained developer, but I spend most days building software with AI. (Approved 2026-11-03.)
- **Buttons:** none. A quiet "Projects ↓" scroll cue instead.

Projects now come before Consulting on the page (2026-11-03).

## Consulting

**Heading:** Consulting

I run RevOps Rocks, a small consultancy for founders and COOs at B2B SaaS companies. I build one revenue system at a time, for a fixed price, in the stack you already use. Most builds are live in about 30 days.

**Example builds**

- **Inbound engine:** new leads get enriched, routed and followed up, without anyone copying data between tools.
- **Renewal pipeline:** renewals show up in HubSpot months ahead, each with an owner and a next step.
- **Forecasting and internal tools:** a forecast you can check line by line, plus the small tools your team keeps asking for.

**How it works** (cut from the site 2026-11-03; it belongs on revops.rocks)

1. A free 30-minute scoping call.
2. A fixed-price proposal.
3. About four weeks of building, in HubSpot most of the time.
4. Handover and training, so your team runs it from there.

(Cut from the site 2026-11-03.) I don't bill by the hour, write strategy decks without building anything, or do Salesforce admin.

**Proof line:** I've been the first RevOps hire through one IPO and two acquisitions. Clients include UpGuard, Sherlok and Elita. RevOps Rocks is a HubSpot Gold Solutions Partner.

At Magnific (formerly Freepik), I led the AI rebuild of a legacy product. It went from zero to hundreds of thousands of weekly users and drove a third of all new subscriptions.

**Buttons:** Book a scoping call → · More at revops.rocks

## Projects

**Heading:** Projects

### KarstScout

- **Card label:** PRJ-01 / GEOSPATIAL
- **Card line:** Finds likely cave entrances in US LiDAR data, and lets you inspect each one in 3D.
- **Tags:** python · pdal · sveltekit · maplibre

**Detail page**

KarstScout scans USGS 3DEP LiDAR for places where a cave entrance is likely. It runs these checks in order:

1. Masks for rock types where caves form.
2. Finds depressions in the ground.
3. Measures how open the terrain is.
4. Checks how deep each opening might go.
5. Scores a shortlist.

It favours precision over recall, so it only flags places it's fairly sure about.

My favourite part is the point view. Click a spot and it streams the raw LiDAR points around it into a 3D view in your browser, up to 12 million of them. You can spin and tilt it, hide everything but the ground, flip the surface so sinkholes show up as mounds, and measure the drop between two points.

I built it for my dad, who's a serious caver. It's invite-only for now, for a small group of cavers and geologists.

- **Status:** live, invite-only
- **Stack:** FastAPI, PDAL and rasterio on Railway, and SvelteKit with MapLibre and deck.gl on Cloudflare

### Stipendium

- **Card label:** PRJ-02 / RESEARCH FUNDING
- **Card line:** Shows individual researchers which grants they can apply for.
- **Tags:** nextjs · supabase · cloudflare r2

**Detail page**

I built Stipendium for researchers looking for funding on their own. Most grant databases are sold to universities, so they're not much help to one person trying to figure out what they can apply for.

It reads the eligibility rules in each funder's own documents and quotes them word for word, so you can check them yourself. When a rule isn't clear, it doesn't list you as eligible.

It covers Australia first, including cross-border cases like a German citizen doing a PhD here.

- **Status:** early, with a waitlist open at stipendium.fyi
- **Stack:** Next.js on Vercel, Supabase, Cloudflare R2 for the source archive, and PostHog without cookies

### RevOps Roles

- **Card label:** PRJ-03 / JOB BOARD
- **Card line:** A job board for RevOps roles, sorted by what the job actually is.
- **Tags:** nextjs · supabase · meilisearch · claude

**Detail page**

Job titles in RevOps don't tell you much. A "Revenue Operations Manager" could be a HubSpot admin, a forecasting analyst or a team lead. RevOps Roles reads each listing and sorts it by the actual work. It adds salary data and job description templates too.

It's for people in RevOps, sales ops, marketing ops, CS ops, enablement and GTM engineering.

It checks more than 50,000 sources for new roles.

- **Status:** live at revopsroles.com
- **Stack:** Next.js on Vercel, BullMQ workers on Railway, Supabase, Meilisearch, Stripe, and the Claude API for classification

### falsy.dev

- **Card label:** PRJ-04 / THIS SITE
- **Card line:** This site, and the live orbit of Mars or the Moon behind it, rendered from real NASA data.
- **Tags:** astro · three.js · webgpu · cloudflare

**Detail page**

The background is a live render of Mars or the Moon from a real orbit, about 200 km up over Mars and 100 km over the Moon. The Sun is where it actually is right now, so the lighting and time of day match the real planet. The readout at the bottom shows where you are.

The terrain comes from NASA data: Mars Global Surveyor elevation and the Viking colour mosaic for Mars, and Lunar Reconnaissance Orbiter elevation and colour for the Moon. I cut each into about 130,000 small tiles, and the page streams only the ones in view, usually a few megabytes. Relief is exaggerated 2.5× so the mountains stand out from this height.

It checks how fast your graphics card is and turns the quality down if it needs to. On phones, or with reduced motion turned on, you get a still image instead.

- **Status:** live, with the code on GitHub at github.com/falsydotdev/falsy.dev (the repo must be public before launch)
- **Stack:** Astro on Cloudflare Workers, three.js with WebGPU (and a WebGL2 fallback), and terrain tiles in Cloudflare R2

## About

**Heading:** About

I'm Justin. I'm American, I live in Adelaide, and I've worked in RevOps since 2012, in the US, the UK, Germany and Australia. I've also managed product and tech teams at EyeEm and at Slidesgo, which is part of Magnific.

I studied physics for four years, first at the University of Arizona and then at the University of Utah, and graduated with a degree in economics and a minor in physics. Physics taught me to measure something before I try to change it. I still work that way, whether it's a CRM or a LiDAR survey.

In JavaScript, a `falsy` value acts false without actually being false. That's kind of how I feel when I talk about being a “developer”. (Approved 2026-11-03.)

Behind this page is Mars or the Moon, rendered from real NASA and USGS data. On a computer, you're watching it live from a real orbit, about 200 km up over Mars and 100 km over the Moon, moving as fast as a spacecraft would, with the Sun where it really is right now. On a phone, you get a still from the same renderer. The mountains are stretched 2.5 times taller so they show up from that height. I built it because I love space and physics, and I wanted my site to show the kind of work I do. (Updated 2026-11-04 to be accurate for both the live view and the stills, and 2026-11-08 for the Moon.)

**Credits (footer):** Terrain from USGS Astrogeology: MOLA elevation and the Viking MDIM 2.1 colour mosaic. Moon data from NASA's Scientific Visualization Studio.

## Contact

**Heading:** Contact

If you want to talk about one of my projects, email is best.

For consulting, the quickest way to start is a 30-minute call. I work Adelaide hours, and the booking page shows times in your time zone.

- **Button:** Book a call → (links to https://meetings-eu1.hubspot.com/justin-powell/book-a-meeting-australia-time-zone)
- **Email, shown as plain text:** hello@falsy.dev

**Form intro:** Or tell me what you're working on, and I'll reply within one business day.

**Form fields:**

- Name
- Work email
- Company
- What are you trying to fix?

- **Submit button:** Send
- **Success message:** Thanks! I'll be in touch soon.
- **Error message:** That didn't send. Try again, or email me at hello@falsy.dev.

## Small text

| Spot | Copy |
|---|---|
| 404 heading | This page is falsy |
| 404 body | There's nothing here but empty space. |
| 404 link | Back to the home page |
| Loading (live scene) | Loading Mars terrain… / Loading lunar terrain… |
| Telemetry example | MARS  18.6°N  226.2°E  LST 06:20  ALT 200 km  v 3.45 km/s  relief×2.5 |
| Explorer edge (v2) | You've reached the edge of the observable universe. Past here, everything is undefined. |
| Reduced-motion note (title text on the readout) | Orbit paused because your device prefers reduced motion. |
