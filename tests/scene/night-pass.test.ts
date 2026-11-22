import { describe, expect, it } from 'vitest';
import { EARTH, MARS, MOON } from '../../src/scene/bodies';
import { sunElevationAt } from '../../src/scene/ephemeris';
import { encodeLight, lightsAround, lightsAt, lightsGrid } from '../../src/scene/lights';
import { sample } from '../../src/scene/orbit';
import { chooseShot, nightPass, seededRandom, type Shot, viewAhead, wantsReshoot } from '../../src/scene/shots';

const plus = (d: Date, s: number) => new Date(d.getTime() + s * 1000);
const lon180 = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

// One lit block, 20° on a side, and nothing anywhere else.
function patchGrid(box: { lat: [number, number]; lon: [number, number] }, light = 0.05) {
  const values = new Uint8Array(360 * 180);
  for (let r = 0; r < 180; r++) {
    for (let c = 0; c < 360; c++) {
      const lat = 89.5 - r;
      const lon = -179.5 + c;
      if (lat > box.lat[0] && lat < box.lat[1] && lon > box.lon[0] && lon < box.lon[1]) values[r * 360 + c] = encodeLight(light);
    }
  }
  const grid = lightsGrid(values, 1);
  return { lightsAround: (lat: number, lon: number, km: number) => lightsAround(lat, lon, km, grid) };
}

// At the March equinox at 00:00 UTC, longitude 0 is at local midnight.
const MIDNIGHT = new Date('2026-03-20T00:00:00Z');
const BOX = { lat: [30, 50] as [number, number], lon: [-10, 10] as [number, number] };
// `marginDeg` allows for the view's reach: ground a few hundred km off the block still sees it.
const inBox = (p: { lat: number; lon: number }, marginDeg = 0) =>
  p.lat > BOX.lat[0] - marginDeg && p.lat < BOX.lat[1] + marginDeg && lon180(p.lon) > BOX.lon[0] - marginDeg && lon180(p.lon) < BOX.lon[1] + marginDeg;
const groundAt = (shot: Shot, date: Date) => sample(shot.orbit, date);

describe('the night pass', () => {
  it('flies over the only lit ground on the night side', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const shot = nightPass(MIDNIGHT, { body: EARTH, rand: seededRandom(seed), ctx: patchGrid(BOX) })!;
      expect(shot.kind).toBe('night-pass');
      const c = groundAt(shot, shot.keyMoment!);
      expect(inBox(c, 3)).toBe(true);
      expect(sunElevationAt(EARTH, shot.keyMoment!, c.lat, c.lon)).toBeLessThan(-10);
    }
  });

  // The view ahead is the ground 8° of orbit in front of the camera, about two minutes away.
  it('holds while the lit block is ahead and re-shoots soon after it passes behind', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const ctx = patchGrid(BOX);
      const shot = nightPass(MIDNIGHT, { body: EARTH, rand: seededRandom(seed), ctx })!;
      let lastAhead = -1;
      let reshoot = -1;
      for (let t = 0; t <= 3600 && reshoot < 0; t += 5) {
        const date = plus(MIDNIGHT, t);
        if (inBox(viewAhead(shot.orbit, date).latLon)) lastAhead = t;
        if (wantsReshoot(shot, MIDNIGHT, date, ctx)) reshoot = t;
      }
      expect(lastAhead).toBeGreaterThan(180);
      // The view reaches 500 km; lit ground still fills enough of it some 250 to 450 km past the
      // block's edge, which is 35 to 65 s of travel.
      expect(reshoot - lastAhead).toBeGreaterThan(30);
      expect(reshoot - lastAhead).toBeLessThan(100);
    }
  });

  it('is kept whatever is ahead until its grace runs out', () => {
    const ctx = patchGrid(BOX);
    const shot = nightPass(MIDNIGHT, { body: EARTH, rand: seededRandom(1), ctx })!;
    for (let t = 0; t < 300; t += 5) expect(wantsReshoot(shot, MIDNIGHT, plus(MIDNIGHT, t), {})).toBe(false);
  });
});

describe('when there is no night pass to fly', () => {
  const dark = patchGrid(BOX, 0);
  // Night pass is last in Earth's weights, so a first roll near 1 asks for it.
  const asksForNight = () => {
    const rest = seededRandom(1);
    let rolled = false;
    return () => (rolled ? rest() : ((rolled = true), 0.999));
  };

  it('finds none over a dark planet or without a lights lookup', () => {
    expect(nightPass(MIDNIGHT, { body: EARTH, rand: seededRandom(1), ctx: dark })).toBeNull();
    expect(nightPass(MIDNIGHT, { body: EARTH, rand: seededRandom(1) })).toBeNull();
  });

  it('flies another kind of shot instead', () => {
    expect(chooseShot(MIDNIGHT, { body: EARTH, rand: asksForNight() }).kind).not.toBe('night-pass');
    expect(chooseShot(MIDNIGHT, { body: EARTH, rand: asksForNight(), ctx: dark }).kind).not.toBe('night-pass');
    expect(chooseShot(MIDNIGHT, { body: EARTH, rand: asksForNight(), ctx: patchGrid(BOX) }).kind).toBe('night-pass');
  });
});

describe('Mars and the Moon', () => {
  const ctx = { lightsAround: (lat: number, lon: number, km: number) => lightsAround(lat, lon, km) };

  it('never fly a night pass, even handed a lights lookup', () => {
    for (const body of [MARS, MOON]) {
      expect(nightPass(MIDNIGHT, { body, rand: seededRandom(1), ctx })).toBeNull();
      for (let i = 0; i < 200; i++) {
        expect(chooseShot(new Date(Date.UTC(2026, 0, 1) + i * 1.7 * 86400e3), { body, rand: seededRandom(i), ctx }).kind).not.toBe('night-pass');
      }
    }
  });
});

// Spread over a year and round the clock.
const DATES = Array.from({ length: 24 }, (_, i) => new Date(Date.UTC(2026, 0, 3) + i * 15.2 * 86400e3 + i * 5.3 * 3600e3));

describe('the night pass over Earth', () => {
  const ctx = { lightsAround: (lat: number, lon: number, km: number) => lightsAround(lat, lon, km) };

  // Lights are fully on with the Sun 8.6° down; within 300 km, lit farmland reads above 3e-3 and desert and ocean below.
  it.each(DATES)('passes over lit cities in full darkness, from %s', (now) => {
    const shot = nightPass(now, { body: EARTH, rand: seededRandom(now.getTime()), ctx })!;
    expect(shot.kind).toBe('night-pass');
    const c = sample(shot.orbit, shot.keyMoment!);
    expect(sunElevationAt(EARTH, shot.keyMoment!, c.lat, c.lon)).toBeLessThan(-8.6);
    expect(lightsAround(c.lat, c.lon, 300)).toBeGreaterThan(3e-3);
    expect(lightsAt(c.lat, c.lon) + lightsAround(c.lat, c.lon, 150)).toBeGreaterThan(1e-3);
  });

  it('builds from the 400 km orbit', () => {
    expect(nightPass(DATES[0], { body: EARTH, rand: seededRandom(1), ctx })!.orbit.a).toBeCloseTo(EARTH.radiusKm + 400, 6);
  });
});
