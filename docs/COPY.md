# falsy.dev copy draft (v1)

This is a first draft in Justin's voice for him to edit. It follows the `sound-like-justin` rules: first person, sentence case, no em dashes, and Australian spelling. Facts come from the RevOpsRocks, RevOpsRoles, stipendium, and KarstScout repos, plus Justin's answers below.

## Answered questions (2026-11-02)

1. **Education:** four years of physics, one at the University of Arizona and three at the University of Utah. Graduated with a degree in economics and a minor in physics.
2. **Magnific:** name it. It's already public on LinkedIn.
3. **RevOps Roles:** checks more than 50,000 sources. No user count.
4. **KarstScout:** mentioning that it was built for Justin's dad is fine.
5. **Reply promise:** "within one business day" stays.

## Meta

- **Title:** Justin Powell · GTM engineering and RevOps
- **Description:** I build AI revenue systems for B2B SaaS companies through RevOps Rocks. Here are my projects, my consulting work, and a live view of Mars.

## Hero

- **Eyebrow:** falsy.dev
- **Headline:** Justin *Powell*
- **Line:** I build AI revenue systems for B2B SaaS teams, mostly in HubSpot. I studied physics and economics, and I've worked in RevOps since 2012.
- **Primary button:** Book a call →
- **Secondary link:** See my projects

## Consulting

**Heading:** Consulting

I run RevOps Rocks, a small consultancy for founders and COOs at B2B SaaS companies. I build one revenue system at a time, for a fixed price, in the stack you already use. Most builds are live in about 30 days.

**Example builds**

- **Inbound engine:** new leads get enriched, routed and followed up, without anyone copying data between tools.
- **Renewal pipeline:** renewals show up in HubSpot months ahead, each with an owner and a next step.
- **Forecasting and internal tools:** a forecast you can check line by line, plus the small tools your team keeps asking for.

**How it works**

1. A free 30-minute scoping call.
2. A fixed-price proposal.
3. About four weeks of building, in HubSpot most of the time.
4. Handover and training, so your team runs it from there.

I don't bill by the hour, write strategy decks without building anything, or do Salesforce admin.

**Proof line:** I've been the first RevOps hire through one IPO and two acquisitions. Clients include UpGuard, Sherlok and Elita. RevOps Rocks is a HubSpot Gold Solutions Partner.

At Magnific (formerly Freepik), I led the AI rebuild of a legacy product. It went from zero to hundreds of thousands of weekly users and drove a third of all new subscriptions.

**Buttons:** Book a scoping call → · More at revops.rocks

## Projects

**Heading:** Projects

### KarstScout

- **Card label:** PRJ-01 / GEOSPATIAL
- **Card line:** Finds likely cave entrances in US LiDAR data.
- **Tags:** python · pdal · sveltekit · maplibre

**Detail page**

KarstScout scans USGS 3DEP LiDAR for places where a cave entrance is likely. It runs these checks in order:

1. Masks for rock types where caves form.
2. Finds depressions in the ground.
3. Measures how open the terrain is.
4. Checks how deep each opening might go.
5. Scores a shortlist.

It favours precision over recall, so it only flags places it's fairly sure about.

I built it for my dad, who's a serious caver. It's invite-only for now, for a small group of cavers and geologists.

- **Status:** live, invite-only
- **Stack:** FastAPI, PDAL and rasterio on Railway, and SvelteKit with MapLibre and deck.gl on Cloudflare

### Stipendium

- **Card label:** PRJ-02 / RESEARCH FUNDING
- **Card line:** Matches individual researchers to the funding they're actually eligible for.
- **Tags:** nextjs · supabase · cloudflare r2

**Detail page**

Most grant databases are sold to universities, and they're hard to use if you're one researcher trying to work out what you can apply for. Stipendium reads the eligibility rules from each funder's own documents and quotes them word for word, so you can check every match yourself.

It starts with Australia, and it handles the tricky cross-border cases, like a German citizen doing a PhD in Australia. When a rule is unclear, it doesn't count you as eligible.

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

## About

**Heading:** About

I'm Justin. I'm American, I live in Adelaide, and I've worked in RevOps since 2012, in the US, the UK, Germany and Australia.

I studied physics for four years, first at the University of Arizona and then at the University of Utah, and graduated with a degree in economics and a minor in physics. Physics taught me to measure something before I try to change it. I still work that way: I look at what's actually in your CRM before I suggest a fix.

The planet behind this page uses real NASA and USGS data, lit by where the Sun is right now. I built it because I like space and wanted my site to show the kind of work I do.

**Credits (footer):** Terrain from USGS Astrogeology: MOLA elevation and the Viking MDIM 2.1 colour mosaic. Moon data from NASA's Scientific Visualization Studio.

## Contact

**Heading:** Contact

The quickest way to start is a 30-minute call. I work Adelaide hours, and the booking page shows times in your time zone.

- **Button:** Book a call → (links to https://meetings-eu1.hubspot.com/justin-powell/book-a-meeting-australia-time-zone)
- **Email, shown as plain text:** justin@revops.rocks

**Form intro:** Or tell me what you're working on, and I'll reply within one business day.

**Form fields:**

- Name
- Work email
- Company
- What are you trying to fix?

- **Submit button:** Send
- **Success message:** Thanks! I'll be in touch soon.
- **Error message:** That didn't send. Try again, or email me at justin@revops.rocks.

## Small text

| Spot | Copy |
|---|---|
| 404 heading | This page is falsy |
| 404 body | There's nothing here but empty space. |
| 404 link | Back to the home page |
| Loading (live scene) | Loading Mars terrain… / Loading lunar terrain… |
| Telemetry example | MARS  18.6°N  226.2°E  LST 06:20  r=1.60 AU  relief×2.5  t×60 |
| Explorer edge (v2) | You've reached the edge of the observable universe. Past here, everything is undefined. |
| Reduced-motion note (title text on the readout) | Time-lapse paused because your device prefers reduced motion. |
