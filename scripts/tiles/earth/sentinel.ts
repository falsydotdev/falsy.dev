// Sentinel-2 Global Mosaic choices that don't need the network: which quarter, which Blue
// Marble month fills the gaps, and how surface reflectance becomes display colour.

import type { ColorPeriod } from '../../../src/scene/telemetry.ts';

const NODATA = -32768;

/**
 * Gains (red, green, blue) and gamma fitted to Blue Marble over the Netherlands test region: the
 * plain ×2.5 true-colour mapping read dark and blue there. The shoulder keeps snow from clipping.
 */
export const TONE = { gain: [2.25, 2.04, 1.2], gamma: 1.4, knee: 0.8 };

/** Display byte (0–255) for a band DN in channel 0 red, 1 green, 2 blue, or null for nodata. */
export function toneReflectance(dn: number, channel: number): number | null {
  if (dn === NODATA) return null;
  const v = Math.pow(Math.max(0, (dn / 10000) * TONE.gain[channel]), 1 / TONE.gamma);
  const { knee } = TONE;
  const shaped = v <= knee ? v : knee + (1 - knee) * (1 - Math.exp(-(v - knee) / (1 - knee)));
  return Math.min(255, Math.round(shaped * 255));
}

/**
 * The most recent mosaic of the current season: this calendar quarter, a year back, since a
 * quarter's mosaic is published the month after it ends.
 */
export function mosaicQuarter(date: Date) {
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  return { year: date.getUTCFullYear() - 1, quarter, firstMonth: String(quarter * 3 - 2).padStart(2, '0') };
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** Blue Marble Next Generation is 2004 only, one base map per month. */
export function bmngMonth(date: Date) {
  const m = date.getUTCMonth();
  return { name: MONTHS[m], stamp: `2004${String(m + 1).padStart(2, '0')}` };
}

/** The period the readout names: Sentinel-2's quarter once its overlay wrote any pixels, else Blue Marble's month. */
export function colorPeriod(date: Date, sentinelPixels: number): ColorPeriod {
  if (sentinelPixels > 0) {
    const { year, quarter } = mosaicQuarter(date);
    return { source: 'sentinel-2', year, quarter };
  }
  return { source: 'blue-marble', year: 2004, month: date.getUTCMonth() + 1 };
}

/** The Sentinel-2 mosaic year a colour period owes Copernicus credit for, or null for Blue Marble only. */
export const copernicusYear = (period: ColorPeriod | undefined): number | null => (period?.source === 'sentinel-2' ? period.year : null);
