import { MARS, MOON, type Body } from '../../src/scene/bodies.ts';
import { chooseShot, dawnDusk, earthrise, featureFlyover, orbitalSunrise, seededRandom, wantsReshoot, type Shot } from '../../src/scene/shots.ts';

const DAY = 86400e3;
const START = Date.UTC(2026, 10, 8);
const round = (x: number) => Math.round(x * 1e9) / 1e9;

const BUILDERS: Record<string, (now: Date, body: Body, seed: number) => Shot | null> = {
  choose: (now, body, seed) => chooseShot(now, { body, rand: seededRandom(seed) }),
  'dawn-dusk': (now, body, seed) => dawnDusk(now, { body, rand: seededRandom(seed) }),
  'orbital-sunrise': (now, body, seed) => orbitalSunrise(now, { body, rand: seededRandom(seed) }),
  'feature-flyover': (now, body, seed) => featureFlyover(now, { body, rand: seededRandom(seed) }),
  earthrise: (now, body, seed) => earthrise(now, { body, rand: seededRandom(seed) }),
};

// The minutes after building at which the re-shoot decision flips, over three hours.
function reshootFlips(shot: Shot, built: Date) {
  const flips: number[] = [];
  let last = false;
  for (let m = 0; m <= 180; m++) {
    const want = wantsReshoot(shot, built, new Date(built.getTime() + m * 60e3));
    if (want !== last) flips.push(m);
    last = want;
  }
  return flips;
}

function record(shot: Shot | null, built: Date) {
  if (!shot) return null;
  const { a, n, e1, e2, theta0, epoch } = shot.orbit;
  return {
    kind: shot.kind,
    feature: shot.feature?.id ?? null,
    keyMoment: shot.keyMoment?.getTime() ?? null,
    orbit: [epoch.getTime(), a, n, ...e1, ...e2, theta0].map(round),
    reshoot: reshootFlips(shot, built),
  };
}

/** Every Mars and Moon shot builder over spread-out dates and seeds, with its re-shoot timeline. */
export function recordShots() {
  const out: Record<string, unknown[]> = {};
  for (const body of [MARS, MOON]) {
    for (const [name, build] of Object.entries(BUILDERS)) {
      const rows: unknown[] = [];
      for (let i = 0; i < 48; i++) {
        const built = new Date(START + i * 1.37 * DAY + i * 2.3 * 3600e3);
        rows.push(record(build(built, body, i), built));
      }
      out[`${body.id} ${name}`] = rows;
    }
  }
  return out;
}
