import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import shots from '../../scripts/posters/shots.json';
import posters from '../../src/data/posters.json';
import { listedBodyIds } from '../../src/scene/bodies';
import { posterChoices, type Poster } from '../../src/scene/posters';

const mars = posters[0] as Poster;
const earthStill = (id: string): Poster => ({ ...mars, id, body: 'Earth', label: `Earth still ${id}` });
const withEarth = [...(posters as Poster[]), earthStill('earth-a'), earthStill('earth-b')];

describe('poster choices', () => {
  it('leaves an unlisted body out of the inlined poster list', () => {
    const bodies = listedBodyIds(false);
    const shown = posterChoices(withEarth, bodies).map((c) => c.body);
    expect(shown).not.toContain('earth');
    expect(new Set(shown)).toEqual(new Set(['mars', 'moon']));
  });

  it('includes a body once it is listed, as in development', () => {
    const shown = posterChoices(withEarth, listedBodyIds(true)).map((c) => c.id);
    expect(shown).toContain('earth-a');
    expect(shown).toContain('earth-b');
  });

  it('keeps the first still as the fallback poster', () => {
    expect(posterChoices(withEarth, listedBodyIds(false))[0].id).toBe('mars-olympus');
  });

  it('describes a still in the readout and its title', () => {
    const [c] = posterChoices([mars], ['mars']);
    expect(c.telemetry).toBe(
      '<span>14.2°N</span><span>225.0°E</span><span>LST 06:43</span><span class="wide">ALT 200 km</span><span class="wide">relief×2.5</span><span class="wide">still 03 NOV 20:25 UTC</span>',
    );
    expect(c.title).toBe(
      'Olympus Mons in the morning. A still frame rendered from MOLA elevation and Viking colour data, lit by the real Sun position at 2026-11-03 20:25 UTC. Relief is exaggerated 2.5×.',
    );
  });
});

describe('poster list weight', () => {
  // Measured 2026-11-23 with Earth listed: index.html is 12,252 B gzipped before Earth stills and
  // 12,727 B with four, against a 13,600 B limit. Those four add 419 B here, so this leaves margin.
  const EARTH_STILLS_MAX_GZ = 700;

  it('fits four Earth stills in the inlined poster list', () => {
    const earthShots = shots.filter((s) => s.id.startsWith('earth-'));
    expect(earthShots).toHaveLength(4);
    const stills = earthShots.map((s, i): Poster => ({
      ...mars,
      id: s.id,
      label: s.label,
      body: 'Earth',
      lat: 52.4 + i,
      lon: 4.6 + i,
      lst: `1${i}:4${i}`,
      altKm: 400,
      at: `2026-11-22T1${5 + i}:0${i}:00.000Z`,
      sources: [960, 1600, 2560].map((width) => ({ src: `/posters/${s.id}-${width}.avif`, width })),
      portrait: { lat: 51 + i, lon: 3 + i, lst: '17:25', altKm: 400, at: `2026-11-22T1${5 + i}:0${i}:00.000Z`, sources: [600, 800, 1170].map((width) => ({ src: `/posters/${s.id}-portrait-${width}.avif`, width })) },
    }));
    const size = (list: Poster[]) => gzipSync(JSON.stringify(posterChoices(list, listedBodyIds(true)))).length;
    expect(size([...(posters as Poster[]), ...stills]) - size(posters as Poster[])).toBeLessThan(EARTH_STILLS_MAX_GZ);
  });
});
