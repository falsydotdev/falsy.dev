// Sentinel-2 Global Mosaic choices that don't need the network: which quarter, which Blue
// Marble month fills the gaps, and how surface reflectance becomes display colour.

const NODATA = -32768;

/**
 * Below the knee this is the Copernicus true-colour visualisation, reflectance × 2.5; above it,
 * an exponential shoulder keeps snow and cloud remnants from clipping flat. Tune with the look test.
 */
export const TONE = { gain: 2.5, knee: 0.8 };

/** Display byte (0–255, already display-encoded like Blue Marble) for a band DN, or null for nodata. */
export function toneReflectance(dn: number): number | null {
  if (dn === NODATA) return null;
  const v = Math.max(0, (dn / 10000) * TONE.gain);
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
