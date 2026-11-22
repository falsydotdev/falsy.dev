import { describe, expect, it } from 'vitest';
import { zoneCoords } from '../../src/scene/timezone';

// Expected coordinates are zone.tab's own (tzdb 2026f), converted from ISO 6709 by hand.
const near = (got: { lat: number; lon: number } | null, lat: number, lon: number) => {
  expect(got).not.toBeNull();
  expect(Math.abs(got!.lat - lat)).toBeLessThan(0.1);
  expect(Math.abs(got!.lon - lon)).toBeLessThan(0.1);
};

describe('a timezone name to its principal city', () => {
  it('finds a northern zone', () => {
    near(zoneCoords('Europe/Amsterdam'), 52.37, 4.9);
  });

  it('finds southern zones, east and west', () => {
    near(zoneCoords('Australia/Sydney'), -33.87, 151.22);
    near(zoneCoords('America/Sao_Paulo'), -23.53, -46.62);
    near(zoneCoords('Pacific/Auckland'), -36.87, 174.77);
  });

  it('keeps each country its own city where zone1970.tab would merge them', () => {
    near(zoneCoords('Europe/Stockholm'), 59.33, 18.05);
    near(zoneCoords('Europe/Oslo'), 59.92, 10.75);
    near(zoneCoords('Europe/Berlin'), 52.5, 13.37);
  });

  it('resolves the legacy names Chrome and Safari report', () => {
    near(zoneCoords('Asia/Calcutta'), 22.53, 88.37);
    near(zoneCoords('Europe/Kiev'), 50.43, 30.52);
    near(zoneCoords('US/Pacific'), 34.05, -118.23);
  });

  it('returns nothing for UTC, Etc zones, clock abbreviations, and unknown names', () => {
    for (const name of ['UTC', 'Etc/UTC', 'Etc/GMT+5', 'Etc/GMT-14', 'GMT', 'Zulu', 'EST', 'CET', 'EST5EDT', 'Mars/Olympus_Mons', 'europe/amsterdam', '', '__proto__', undefined, null]) {
      expect(zoneCoords(name)).toBeNull();
    }
  });
});
