import { readBundle, writeBundle } from '../shared/bundle.js';

export const NOAA_BUCKET = 'noaa-gmgsi-pds';
const NOAA = `https://${NOAA_BUCKET}.s3.amazonaws.com`;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
export const STALE_MS = 6 * HOUR_MS;
const LOOKBACK_HOURS = 9;
const WINDOW_DAYS = 14;
// Fills a fresh or gappy clear-sky history a few days per run, so day one isn't cloudless.
const BACKFILL_PER_RUN = 4;
const IMMUTABLE = 'public, max-age=31536000, immutable';
const SHORT = 'public, max-age=300';

const stampOf = (date) => date.toISOString().slice(0, 16).replace(/[-:]/g, '') + 'Z';
const dayOf = (date) => date.toISOString().slice(0, 10).replaceAll('-', '');
const hourPrefix = (date) => {
  const [y, m, d, h] = date.toISOString().match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d)/).slice(1);
  return `GMGSI_LW/${y}/${m}/${d}/${h}/`;
};
const validOf = (key) => {
  const [, y, mo, d, h, mi] = key.match(/_s(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)/);
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi));
};
// Each 3-hour run keeps its own clear-sky history, so the reference has the same time of day.
const slotOf = (date) => String(Math.floor(date.getUTCHours() / 3) * 3).padStart(2, '0');

// Cloudflare account IDs are 32 hex digits and object IDs longer; logs stay public-repo safe.
export const redact = (text) => String(text).replace(/\b[0-9a-f]{32,}\b/gi, '[id]');

async function newestFile(fetch, hour) {
  const res = await fetch(`${NOAA}/?list-type=2&prefix=${encodeURIComponent(hourPrefix(hour))}`);
  if (!res.ok) throw new Error(`NOAA listing returned ${res.status}`);
  const files = [...(await res.text()).matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)]
    .map(([, c]) => ({ key: c.match(/<Key>([^<]+)<\/Key>/)?.[1], size: Number(c.match(/<Size>(\d+)<\/Size>/)?.[1]) }))
    .filter((f) => f.key?.endsWith('.nc') && f.size > 0)
    .sort((a, b) => (a.key < b.key ? -1 : 1));
  return files.at(-1) ?? null;
}

async function findSource(fetch, now) {
  const top = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
  for (let h = 0; h <= LOOKBACK_HOURS; h++) {
    const file = await newestFile(fetch, new Date(top - h * HOUR_MS));
    if (file) return file;
  }
  return null;
}

// Opened only when the bundle reaches the part: Workers cap open connections at six and cancel
// idle responses beyond that.
const download = (fetch, { key, size }) => ({
  size,
  body: async () => {
    const res = await fetch(`${NOAA}/${key}`);
    if (!res.ok) throw new Error(`NOAA download returned ${res.status}`);
    return res.body;
  },
});

async function process({ bucket, fetch, container, source, valid, log }) {
  const { key } = source;
  const slot = slotOf(valid);
  const today = dayOf(valid);
  const days = Array.from({ length: WINDOW_DAYS + 1 }, (_, i) => dayOf(new Date(valid.getTime() - i * DAY_MS)));
  const listed = (await bucket.list({ prefix: `state/${slot}/` })).objects;
  const stored = new Map(listed.map((o) => [o.key.split('/').pop(), o.size]));

  const parts = [];
  for (const day of days.filter((d) => stored.has(d))) {
    const body = async () => (await bucket.get(`state/${slot}/${day}`)).body;
    parts.push({ name: `history/${day}`, size: stored.get(day), body });
  }
  let backfilled = 0;
  for (const day of days.filter((d) => d !== today && !stored.has(d))) {
    if (backfilled === BACKFILL_PER_RUN) break;
    const past = new Date(valid.getTime() - (days.indexOf(day) * DAY_MS));
    const file = await newestFile(fetch, past).catch(() => null);
    if (!file) continue;
    parts.push({ name: `backfill/${day}`, ...download(fetch, file) });
    backfilled++;
  }
  const request = new TextEncoder().encode(JSON.stringify({ source: { bucket: NOAA_BUCKET, key }, valid: valid.toISOString() }));
  parts.unshift({ name: 'request.json', size: request.length, body: request }, { name: 'gmgsi.nc', ...download(fetch, source) });

  const { stream, length } = writeBundle(parts);
  const body = typeof FixedLengthStream === 'function' ? stream.pipeThrough(new FixedLengthStream(length)) : stream;
  log.info(`processing ${key} with ${parts.length - 2} history and backfill parts (${length} B)`);
  const res = await container.fetch('http://clouds/process', { method: 'POST', body, duplex: 'half' });
  if (!res.ok) throw new Error(`container returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const out = new Map(readBundle(new Uint8Array(await res.arrayBuffer())).map((p) => [p.name, p.bytes]));

  for (const [name, bytes] of out) {
    if (name.startsWith('state/')) {
      await bucket.put(`state/${slot}/${name.slice('state/'.length)}`, bytes, {
        httpMetadata: { contentType: 'application/gzip' },
      });
    }
  }
  const stamp = stampOf(valid);
  await bucket.put(`dated/${stamp}/clouds.avif`, out.get('clouds.avif'), {
    httpMetadata: { contentType: 'image/avif', cacheControl: IMMUTABLE },
  });
  await bucket.put(`dated/${stamp}/meta.json`, out.get('meta.json'), {
    httpMetadata: { contentType: 'application/json', cacheControl: IMMUTABLE },
  });
  const meta = JSON.parse(new TextDecoder().decode(out.get('meta.json')));
  return { ...meta, path: `dated/${stamp}/clouds.avif` };
}

async function keepPinned({ bucket, keep, now, log }) {
  const due = keep.map((m) => new Date(m)).filter((m) => m <= now);
  if (!due.length) return;
  const indexObject = await bucket.get('kept/index.json');
  const index = indexObject ? await indexObject.json() : {};
  const pending = due.filter((m) => !(m.toISOString() in index));
  if (!pending.length) return;
  const stamps = (await bucket.list({ prefix: 'dated/', delimiter: '/' })).delimitedPrefixes
    .map((p) => p.slice('dated/'.length, -1))
    .sort();
  let changed = false;
  for (const moment of pending) {
    const floor = stampOf(new Date(moment.getTime() - STALE_MS));
    const stamp = stamps.filter((s) => s > floor && s <= stampOf(moment)).at(-1);
    if (!stamp) continue;
    for (const file of ['clouds.avif', 'meta.json']) {
      const object = await bucket.get(`dated/${stamp}/${file}`);
      if (object) await bucket.put(`kept/${stamp}/${file}`, object.body, { httpMetadata: object.httpMetadata });
    }
    index[moment.toISOString()] = stamp;
    changed = true;
    log.info(`kept ${stamp} for the poster moment ${moment.toISOString()}`);
  }
  if (changed) {
    await bucket.put('kept/index.json', JSON.stringify(index), {
      httpMetadata: { contentType: 'application/json', cacheControl: SHORT },
    });
  }
}

export async function runJob({ bucket, fetch, container, now, keep = [], log = console }) {
  const say = { info: (m) => log.info(redact(m)), error: (m) => log.error(redact(m)) };
  const latestObject = await bucket.get('latest.json');
  let current = latestObject ? await latestObject.json() : null;
  let fallback = null;

  try {
    const source = await findSource(fetch, now);
    const valid = source && validOf(source.key);
    if (!source) fallback = 'source-missing';
    else if (now - valid > STALE_MS) fallback = 'source-stale';
    else {
      const done = await bucket.get(`dated/${stampOf(valid)}/meta.json`);
      let set = null;
      if (done) {
        say.info(`already processed ${source.key}`);
        const meta = await done.json();
        // A run that died between the dated set and latest.json left the pointer behind.
        if (!current || new Date(current.valid) < new Date(meta.valid)) set = { ...meta, path: `dated/${stampOf(valid)}/clouds.avif` };
      } else set = await process({ bucket, fetch, container, source, valid, log: say });
      if (set?.fallback) fallback = set.fallback;
      else if (set) current = set;
    }
  } catch (error) {
    fallback = fallback ?? 'process-failed';
    say.error(`cloud run failed: ${error?.message ?? error}`);
  }
  if (fallback) say.info(`keeping the last good clouds (${fallback})`);

  try {
    await keepPinned({ bucket, keep, now, log: say });
  } catch (error) {
    say.error(`keeping poster clouds failed: ${error?.message ?? error}`);
  }

  const age = current ? now - new Date(current.valid) : Infinity;
  const stale = age > STALE_MS;
  if (current) {
    const { checked: _c, stale: _s, fallback: _f, ...set } = current;
    await bucket.put('latest.json', JSON.stringify({ ...set, fallback, stale, checked: now.toISOString() }), {
      httpMetadata: { contentType: 'application/json', cacheControl: SHORT },
    });
  }
  if (stale) {
    const hours = current ? `${(age / HOUR_MS).toFixed(1)} h old (${current.valid})` : 'missing';
    say.error(`clouds stale: the newest cloud set is ${hours}`);
  }
  return { alert: stale, fallback, valid: current?.valid ?? null };
}
