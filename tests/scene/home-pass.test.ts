import { describe, expect, it } from 'vitest';
import { EARTH, MARS } from '../../src/scene/bodies';
import { bodyFrame, bodyVector, fromBody, vec } from '../../src/scene/ephemeris';
import { homePass } from '../../src/scene/home-pass';
import { lightsAround, lightsGrid } from '../../src/scene/lights';
import { sample } from '../../src/scene/orbit';
import { cameraRight, chooseShot, seededRandom, type Shot } from '../../src/scene/shots';
import { zoneCoords } from '../../src/scene/timezone';

const plus = (d: Date, s: number) => new Date(d.getTime() + s * 1000);
const grid = (value: number) => lightsGrid(new Uint8Array(360 * 180).fill(value), 1);
const lit = { lightsAround: (lat: number, lon: number, km: number) => lightsAround(lat, lon, km, grid(255)) };
const dark = { lightsAround: (lat: number, lon: number, km: number) => lightsAround(lat, lon, km, grid(0)) };

const amsterdam = zoneCoords('Europe/Amsterdam')!;
const sydney = zoneCoords('Australia/Sydney')!;
const night = new Date('2026-11-22T21:00:00Z');

// The closest the ground track comes to `place` in the first ten minutes, in km, and which side it passes on.
function closest(shot: Shot, place: { lat: number; lon: number }) {
  const target = bodyVector(place.lat, place.lon);
  let best = { km: Infinity, right: 0 };
  for (let s = 0; s <= 600; s++) {
    const c = sample(shot.orbit, plus(shot.orbit.epoch, s));
    const km = EARTH.radiusKm * Math.acos(Math.min(1, vec.dot(vec.norm(c.rBody), target)));
    if (km < best.km) best = { km, right: vec.dot(fromBody(bodyFrame(EARTH, c.date), target), cameraRight(c.r, c.v)) };
  }
  return best;
}

describe('the home pass', () => {
  it('flies about 150 km beside a lit home at night, with home on the right', () => {
    const shot = homePass(night, { body: EARTH, home: amsterdam, ctx: lit })!;
    expect(shot.kind).toBe('home-pass');
    const { km, right } = closest(shot, amsterdam);
    expect(km).toBeGreaterThan(140);
    expect(km).toBeLessThan(160);
    expect(right).toBeGreaterThan(0);
  });

  it('flies past real city lights at night', () => {
    expect(homePass(night, { body: EARTH, home: amsterdam, ctx: { lightsAround } })?.kind).toBe('home-pass');
  });

  it('falls back at night over ground with no city lights', () => {
    expect(homePass(night, { body: EARTH, home: amsterdam, ctx: dark })).toBeNull();
    expect(homePass(night, { body: EARTH, home: amsterdam })).toBeNull();
  });

  it('needs no city lights by day, north or south', () => {
    expect(homePass(new Date('2026-11-22T13:00:00Z'), { body: EARTH, home: amsterdam, ctx: dark })?.kind).toBe('home-pass');
    // 07:00 in Sydney.
    const morning = homePass(new Date('2026-11-22T20:00:00Z'), { body: EARTH, home: sydney, ctx: dark })!;
    expect(morning.kind).toBe('home-pass');
    expect(closest(morning, sydney).km).toBeLessThan(160);
  });

  it('judges the lights of the home region, not the ground beyond it', () => {
    // Only the cells within about 200 km of home are lit.
    const values = new Uint8Array(360 * 180);
    for (let row = 0; row < 180; row++) {
      for (let col = 0; col < 360; col++) {
        const km = EARTH.radiusKm * Math.acos(Math.min(1, vec.dot(bodyVector(89.5 - row, col - 179.5), bodyVector(amsterdam.lat, amsterdam.lon))));
        if (km < 200) values[row * 360 + col] = 255;
      }
    }
    const nearHome = lightsGrid(values, 1);
    const shot = homePass(night, { body: EARTH, home: amsterdam, ctx: { lightsAround: (lat, lon, km) => lightsAround(lat, lon, km, nearHome) } });
    expect(shot?.kind).toBe('home-pass');
  });

  it('has nothing to fly past without a usable zone, or away from Earth', () => {
    expect(homePass(night, { body: EARTH, home: zoneCoords('Etc/UTC'), ctx: lit })).toBeNull();
    expect(homePass(night, { body: EARTH, home: zoneCoords('Not/A_Zone'), ctx: lit })).toBeNull();
    expect(homePass(night, { body: MARS, home: amsterdam, ctx: lit })).toBeNull();
  });

  it('follows the body config, not the body id', () => {
    const withoutPass = { ...EARTH, shots: { ...EARTH.shots, homePass: false } };
    expect(homePass(night, { body: withoutPass, home: amsterdam, ctx: lit })).toBeNull();
    const renamed = { ...EARTH, id: 'terra' };
    expect(homePass(night, { body: renamed, home: amsterdam, ctx: lit })?.kind).toBe('home-pass');
  });

  it('leaves the normal shot mix exactly as it was when it falls back', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const rand = seededRandom(seed);
      const shot = homePass(night, { body: EARTH, home: amsterdam, ctx: dark, rand }) ?? chooseShot(night, { body: EARTH, rand });
      expect(shot).toEqual(chooseShot(night, { body: EARTH, rand: seededRandom(seed) }));
    }
  });

  it('carries no trace of where home is', () => {
    const shot = homePass(night, { body: EARTH, home: amsterdam, ctx: lit })!;
    expect(Object.keys(shot).sort()).toEqual(['keyMoment', 'kind', 'orbit']);
  });
});
