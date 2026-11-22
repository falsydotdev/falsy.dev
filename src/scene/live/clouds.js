import * as THREE from 'three/webgpu';
import {
  If, asin, atan, clamp, cos, dot, float, length, log2, max, mx_noise_float, mx_noise_vec3, normalize, select, sin, smoothstep, sqrt, texture, uniform, vec2, vec3, vec4,
} from 'three/tsl';
import { CLOUD_TEXTURE, cloudsNewer } from '../clouds.ts';

const DEG = Math.PI / 180;
// Clouds thin out over this much latitude before the edge of the source's data.
const CAP_FADE_RAD = 1.5 * DEG;
// Thick cloud lets through about a tenth of the sunlight.
const SHADOW_DARKNESS = 0.85;
// Detail noise octaves, coarsest first (wavelengths in km). The map's texels are about 10 km, so
// the noise picks up below that; each octave fades out before it would alias.
const DETAIL_KM = [24, 12, 6, 3];
const DETAIL_STRENGTH = 1.6;
// The map is warped by up to about half a texel, so close-in clouds don't show its grid.
const WARP_KM = 20;
// Cloud tops are lit from the side as well as from above, so a low Sun still lights them.
const SIDE_LIGHT = 0.4;

// The cloud job's bucket. In development, a local stand-in laid out like it, served at /data/clouds
// (FALSY_TILES_CLOUDS picks its folder); clouds.falsy.dev only answers the production site.
export const CLOUDS_BASE = import.meta.env.PUBLIC_CLOUDS_BASE || (import.meta.env.DEV ? '/data/clouds' : null);
const POINTER_TIMEOUT_MS = 5000;

/**
 * Starts fetching and decoding the first cloud set that loads, in a worker.
 * @param {import('../clouds.ts').CloudCandidate[]} candidates best first
 */
export function loadCloudSet(candidates) {
  const worker = new Worker(new URL('./cloud-worker.js', import.meta.url), { type: 'module' });
  const done = new Promise((resolve) => {
    worker.onmessage = ({ data }) => resolve(data.error ? data : { ...data, source: candidates[data.index].source });
    worker.onerror = (e) => resolve({ error: e.message ?? 'cloud worker failed' });
    worker.postMessage({ candidates, ...CLOUD_TEXTURE });
  }).finally(() => worker.terminate());
  return { done, cancel: () => worker.terminate() };
}

/**
 * Earth's cloud layer: a coverage map on a shell at the body's cloud height, lit through the
 * atmosphere tables. The atmosphere march draws it (`crossings`, `composite`), the terrain
 * multiplies in its shadows (`shadowAt`), and anything else can read `coverage`.
 * @param {{ body: import('../bodies.ts').Body, lighting: ReturnType<typeof import('./terrain.js').createLighting>, tables: Awaited<ReturnType<typeof import('./atmosphere-tables.js').createAtmosphereTables>>, set: ReturnType<typeof loadCloudSet> }} opts
 */
export function createClouds({ body, lighting, tables, set }) {
  const cfg = body.clouds;
  const R = body.radiusKm;
  const Rc = R + cfg.heightKm;
  const { width: W, height: H } = CLOUD_TEXTURE;
  const texelKm = (2 * Math.PI * Rc) / W;

  // Full size from the start and filled in place, like the shadow map: the material compiles first.
  const levels = [];
  for (let w = W, h = H; ; w = Math.max(1, w >> 1), h = Math.max(1, h >> 1)) {
    levels.push({ data: new Uint8Array(w * h), width: w, height: h });
    if (w === 1 && h === 1) break;
  }
  const tex = new THREE.DataTexture(levels[0].data, W, H, THREE.RedFormat, THREE.UnsignedByteType);
  tex.mipmaps = levels;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  const map = texture(tex);

  const u = {
    shadows: uniform(1),
    relief: uniform(1),
    // Radians per screen pixel, for the noise and mip choice.
    pixelAngle: uniform(0.001),
    north: uniform(90 * DEG),
    south: uniform(-90 * DEG),
  };

  const state = {
    status: /** @type {import('../clouds.ts').CloudStatus} */ ('loading'),
    /** @type {import('../clouds.ts').CloudSetInfo | null} */
    set: null,
    polar: null,
    meta: null,
    bytes: 0,
  };
  const show = (out) => {
    tex.mipmaps = out.levels;
    tex.image = { data: out.levels[0].data, width: W, height: H };
    tex.needsUpdate = true;
    state.set = { source: out.source, valid: new Date(out.meta.valid) };
    state.meta = out.meta;
    state.polar = out.meta.polar;
    state.bytes = out.bytes;
    u.north.value = out.meta.polar.north * DEG;
    u.south.value = out.meta.polar.south * DEG;
    state.status = 'ready';
  };
  set.done.then((out) => {
    if (!out.error) return show(out);
    state.status = 'failed';
    console.warn('No clouds:', out.error);
  });

  let disposed = false;
  let refreshing = null;
  /**
   * Loads the latest set if the pointer names a newer one than the set on screen, which stays up
   * while the new one decodes and if it fails.
   */
  const refresh = async (latestUrl) => {
    if (refreshing || disposed || state.status === 'loading') return;
    const pointer = await fetch(latestUrl, { signal: AbortSignal.timeout(POINTER_TIMEOUT_MS) })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (refreshing || disposed || !cloudsNewer(state.set, pointer?.valid ?? null)) return;
    refreshing = loadCloudSet([{ url: latestUrl, source: 'live' }]);
    const out = await refreshing.done;
    refreshing = null;
    if (disposed) return;
    if (out.error) console.warn('Kept the clouds on screen:', out.error);
    else show(out);
  };

  // Same mapping as cloudUv in clouds.ts: row 0 at 90°N, column 0 at 180°W.
  const uvOf = (lat, lon) => vec2(lon.add(Math.PI).div(2 * Math.PI), float(Math.PI / 2).sub(lat).div(Math.PI));
  const capFade = (lat) => smoothstep(u.north.sub(CAP_FADE_RAD), u.north, lat).oneMinus().mul(smoothstep(u.south, u.south.add(CAP_FADE_RAD), lat));
  const sampleAt = (lat, lon, lod) => map.sample(uvOf(lat, lon)).level(lod).r;

  /** Cloud cover from 0 to 1 over world-space unit direction `n`, at mip level `lod` (coarser is softer). */
  const coverage = (n, lod = float(0)) => {
    const lat = asin(n.y);
    const lon = atan(n.z.negate(), n.x);
    return sampleAt(lat, lon, lod).mul(capFade(lat));
  };

  /** Sunlight reaching ground point `p` (world km) past the clouds, 0 to 1. One coarse sample. */
  const shadowAt = (p, sun) => {
    const lit = float(1).toVar();
    If(u.shadows.greaterThan(0.5), () => {
      const b = dot(p, sun);
      const t = b.negate().add(sqrt(max(b.mul(b).sub(dot(p, p)).add(Rc * Rc), 0)));
      If(length(p).lessThan(Rc), () => {
        lit.assign(coverage(normalize(p.add(sun.mul(t))), float(2)).mul(-SHADOW_DARKNESS).add(1));
      });
    });
    return lit;
  };

  // Colour (terrain units, as the ground's own lighting) and opacity of the shell where ray
  // ro + rd·t crosses it.
  const surface = (ro, rd, t, sun) => {
    const pc = ro.add(rd.mul(t));
    const up = normalize(pc);
    const lat = asin(up.y);
    const lon = atan(up.z.negate(), up.x);
    const footprint = t.mul(u.pixelAngle);
    const slant = float(1).div(max(dot(rd, up).abs(), 0.05));
    const lod = max(log2(footprint.mul(sqrt(slant)).div(texelKm)), 0);
    const warp = mx_noise_vec3(pc.div(WARP_KM)).mul(clamp(float(WARP_KM).div(footprint.mul(slant).mul(2)).sub(1), 0, 1)).mul(0.5 * texelKm / Rc);
    const c = sampleAt(lat.add(warp.y), lon.add(warp.x.div(max(cos(lat), 0.05))), lod).mul(capFade(lat));

    // Synthesised detail only reshapes partial cover: clear sky stays clear and full decks stay solid.
    let detail = float(0);
    DETAIL_KM.forEach((km, k) => {
      // Full strength at 4 pixels a wavelength, gone at 2.
      const fade = clamp(float(km).div(footprint.mul(slant).mul(2)).sub(1), 0, 1);
      detail = detail.add(mx_noise_float(pc.div(km).add(k * 17.3)).mul(0.5 ** k).mul(fade));
    });
    const alpha = smoothstep(0.08, 0.92, c.add(detail.mul(DETAIL_STRENGTH).mul(c).mul(c.oneMinus()).mul(4)));

    const N = up.toVar();
    If(u.relief.greaterThan(0.5), () => {
      const east = vec3(sin(lon).negate(), 0, cos(lon).negate());
      const north = vec3(sin(lat).negate().mul(cos(lon)), cos(lat), sin(lat).mul(sin(lon)));
      const dLon = float((2 * Math.PI) / W);
      const dLat = float(Math.PI / H);
      const gE = sampleAt(lat, lon.add(dLon), lod).sub(sampleAt(lat, lon.sub(dLon), lod)).div(max(cos(lat), 0.05).mul(2 * texelKm));
      const gN = sampleAt(lat.add(dLat), lon, lod).sub(sampleAt(lat.sub(dLat), lon, lod)).div(2 * texelKm);
      N.assign(normalize(up.sub(east.mul(gE).add(north.mul(gN)).mul(cfg.reliefKm))));
    });

    const muS = dot(up, sun);
    // The planet's own shadow at cloud height: tops stay lit until the Sun is ~3° below the ground's horizon.
    const b = dot(pc, sun);
    const miss = sqrt(max(dot(pc, pc).sub(b.mul(b)), 0));
    const sunlit = select(b.greaterThan(0), float(1), smoothstep(R - 2, R + 6, miss));
    const side = dot(N, sun).clamp(0, 1).mul(1 - SIDE_LIGHT).add(SIDE_LIGHT);
    const direct = vec3(lighting.sunColor).mul(lighting.sunIntensity).mul(tables.transmittance(float(Rc), muS)).mul(sunlit.mul(side));
    const sky = vec3(lighting.skyTint).mul(lighting.ambient).mul(smoothstep(-0.2, 0.25, muS));
    return vec4(direct.add(sky).mul(cfg.albedo), alpha);
  };

  /**
   * Where view ray ro + rd·t crosses the shell before `tEnd`: once looking at the ground, twice for
   * a ray past the limb that dips below cloud height. Each has its parameter, colour, and a flag.
   */
  const crossings = (ro, rd, tEnd, sun) => {
    const b = dot(ro, rd);
    const disc = b.mul(b).sub(dot(ro, ro)).add(Rc * Rc);
    const sq = sqrt(max(disc, 0));
    return [b.negate().sub(sq), b.negate().add(sq)].map((tRaw) => {
      const t = tRaw.toVar();
      const color = vec4(0).toVar();
      If(disc.greaterThan(0).and(t.greaterThan(0)).and(t.lessThan(tEnd)), () => color.assign(surface(ro, rd, t, sun)));
      return { t, color, pending: float(1).toVar() };
    });
  };

  /** Lays the crossings the march has passed at `t` over what's behind them. */
  const composite = (list, t, throughput, light, force = false) => {
    for (const c of list) {
      const due = force ? c.pending.greaterThan(0.5) : c.pending.greaterThan(0.5).and(t.greaterThan(c.t));
      If(due, () => {
        light.addAssign(throughput.mul(c.color.rgb).mul(c.color.a));
        throughput.mulAssign(c.color.a.oneMinus());
        c.pending.assign(0);
      });
    }
  };

  /** @param {import('../quality.ts').Tier} tier @param {boolean} shadowsOff the `fx=` toggle */
  const setTier = (tier, shadowsOff) => {
    u.shadows.value = tier.cloudShadows && !shadowsOff ? 1 : 0;
    u.relief.value = tier.cloudRelief ? 1 : 0;
  };

  return {
    state,
    uniforms: u,
    coverage,
    shadowAt,
    crossings,
    composite,
    setTier,
    refresh,
    dispose: () => {
      disposed = true;
      set.cancel();
      refreshing?.cancel();
      tex.dispose();
    },
  };
}
