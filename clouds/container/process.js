// Pure cloud processing: GMGSI Mercator counts in, an equirectangular opacity texture out.
// Every plane is WIDTH×HEIGHT bytes, row 0 at 90°N and column 0 at 180°W; 0 means no data.

export const WIDTH = 4096;
export const HEIGHT = 2048;
export const WINDOW_DAYS = 14;
// Opacity ramps from START to FULL counts colder than the clear-sky reference. Tune with a look test.
export const OPACITY_START = 8;
export const OPACITY_FULL = 72;
// Below this many earlier days the reference is mostly today's clouds, so opacity reads low.
export const MIN_CLEAR_SKY_DAYS = 3;

const DAY_MS = 86_400_000;
const mercator = (deg) => Math.log(Math.tan(Math.PI / 4 + (deg * Math.PI) / 360));

export const dayKey = (date) => date.toISOString().slice(0, 10).replaceAll('-', '');

function sourceRows(grid) {
  const { lat, height } = grid;
  const y0 = mercator(lat[0]);
  const dy = (y0 - mercator(lat[height - 1])) / (height - 1);
  const at = (deg) => (y0 - mercator(deg)) / dy;
  const ranges = new Int32Array(HEIGHT * 2).fill(-1);
  for (let j = 0; j < HEIGHT; j++) {
    const a = at(90 - (j * 180) / HEIGHT);
    const b = at(90 - ((j + 1) * 180) / HEIGHT);
    if (b <= -0.5 || a >= height - 0.5) continue;
    let r0 = Math.max(0, Math.ceil(a));
    let r1 = Math.min(height - 1, Math.ceil(b) - 1);
    if (r1 < r0) r0 = r1 = Math.min(height - 1, Math.max(0, Math.round((a + b) / 2)));
    ranges[j * 2] = r0;
    ranges[j * 2 + 1] = r1;
  }
  return ranges;
}

function sourceCols(grid) {
  const { lon, width } = grid;
  const step = (lon[width - 1] - lon[1]) / (width - 2);
  const lon0 = lon[1] - step;
  const global = Math.abs(width * step - 360) < step;
  const at = (deg) => (deg - lon0) / step;
  const offsets = new Int32Array(WIDTH + 1);
  const cols = [];
  for (let k = 0; k < WIDTH; k++) {
    offsets[k] = cols.length;
    const a = at(-180 + (k * 360) / WIDTH);
    const b = at(-180 + ((k + 1) * 360) / WIDTH);
    let c0 = Math.ceil(a);
    let c1 = Math.ceil(b) - 1;
    if (c1 < c0) c0 = c1 = Math.round((a + b) / 2);
    for (let c = c0; c <= c1; c++) {
      if (global) cols.push(((c % width) + width) % width);
      else if (c >= 0 && c < width) cols.push(c);
    }
  }
  offsets[WIDTH] = cols.length;
  return { offsets, cols: Int32Array.from(cols) };
}

// Box-averages the valid source counts under each output pixel.
export function reproject(grid) {
  const rows = sourceRows(grid);
  const { offsets, cols } = sourceCols(grid);
  const { counts, width } = grid;
  const plane = new Uint8Array(WIDTH * HEIGHT);
  for (let j = 0; j < HEIGHT; j++) {
    const r0 = rows[j * 2];
    if (r0 < 0) continue;
    const r1 = rows[j * 2 + 1];
    for (let k = 0; k < WIDTH; k++) {
      let sum = 0;
      let n = 0;
      for (let r = r0; r <= r1; r++) {
        const base = r * width;
        for (let i = offsets[k]; i < offsets[k + 1]; i++) {
          const v = counts[base + cols[i]];
          if (v) {
            sum += v;
            n++;
          }
        }
      }
      if (n) plane[j * WIDTH + k] = Math.round(sum / n);
    }
  }
  return plane;
}

const warmest = (a, b) => (a === 0 ? b : b === 0 ? a : Math.min(a, b));

export function processClouds({ grid, history, source, windowDays = WINDOW_DAYS }) {
  const observed = reproject(grid);
  const today = dayKey(grid.valid);
  const first = dayKey(new Date(grid.valid.getTime() - windowDays * DAY_MS));
  const earlier = history.filter((h) => h.day >= first && h.day < today);
  const existing = history.find((h) => h.day === today);

  const plane = new Uint8Array(observed);
  if (existing) for (let i = 0; i < plane.length; i++) plane[i] = warmest(plane[i], existing.plane[i]);

  const opacity = new Uint8Array(WIDTH * HEIGHT);
  const span = OPACITY_FULL - OPACITY_START;
  for (let i = 0; i < opacity.length; i++) {
    const v = observed[i];
    if (!v) continue;
    let ref = plane[i];
    for (const h of earlier) ref = warmest(ref, h.plane[i]);
    const t = (v - ref - OPACITY_START) / span;
    opacity[i] = t <= 0 ? 0 : t >= 1 ? 255 : Math.round(t * 255);
  }

  const days = new Set(earlier.map((h) => h.day)).size;
  const meta = {
    valid: grid.valid.toISOString(),
    source: {
      name: 'NOAA GMGSI longwave infrared',
      bucket: source.bucket,
      key: source.key,
      created: grid.created ? grid.created.toISOString() : null,
    },
    texture: {
      width: WIDTH,
      height: HEIGHT,
      projection: 'equirectangular',
      origin: 'row 0 at 90°N, column 0 at 180°W, east-positive',
      channel: 'r',
      values: 'cloud opacity, 0 clear to 255 opaque',
    },
    polar: {
      north: round4(grid.lat[0]),
      south: round4(grid.lat[grid.height - 1]),
      beyond: 'no data; opacity 0',
    },
    clearSky: { days, windowDays, rule: 'warmest count at this hour over the window' },
    opacity: { start: OPACITY_START, full: OPACITY_FULL, units: 'GMGSI 8-bit counts colder than clear sky' },
    fallback: days < MIN_CLEAR_SKY_DAYS ? 'warming-up' : null,
  };
  return { opacity, state: { day: today, plane }, meta };
}

const round4 = (x) => Math.round(x * 1e4) / 1e4;
