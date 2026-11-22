import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, asin, atan, attribute, clamp, cos, cross, dot, exp, float, instancedDynamicBufferAttribute, int, max, min,
  normalize, positionWorld, pow, round, select, sin, smoothstep, sqrt, tan, texture, uniform, uniformArray, uv, varying, vec2, vec3, vec4,
  cameraPosition,
} from 'three/tsl';
import { LIGHTS_GAMMA } from '../tiles/lights-codec.ts';
import { FACES, parent, tileId } from '../tiles/cube.ts';
import { drawnHeightRangeKm, isOpenSea, layerTile, layerTilesFor, layerWants, selectTiles, tilesToFetch } from '../tiles/select.ts';
import { TILES, HEIGHT_SIZE, SHADOW_MAP } from '../tiles/layout.ts';
import { layerPath } from '../tiles/layers.ts';
import { LayerArray } from './tile-atlas.js';
import { toWorld } from './terrain.js';

const GRID = 32;
const MAX_INSTANCES = 4096;
// Most tiles miss the edge cache, so each costs a round trip to storage, not bandwidth. The tile
// host allows 256 HTTP/2 streams; 64 keeps a cold load latency-bound for far less time.
const MAX_IN_FLIGHT = 64;
// Over a network the camera keeps moving while tiles arrive, so a few edge tiles are always
// in flight; they draw from their nearest loaded ancestor meanwhile.
const SETTLED_FRACTION = 0.95;
// Records for tiles without GPU data are dropped after this many unused frames, so a long
// session that keeps flying over new ground doesn't accumulate them.
const RECORD_TTL_FRAMES = 600;
const WORKERS = 4;
// The march samples a 10 km map, so 12 steps cast the same shadows as 44. Each step strides
// 1.62× further, reaching the same ~560 km.
const SHADOW_STEPS = 12;
const SHADOW_GROWTH = 1.617;
// What an optional layer's instance attribute holds when no tile of it has loaded: a negative layer index.
const NO_DATA = [-1, 0, 0, 0];
// An open-sea tile's height attribute: no layer, and a whole-tile scale so normals difference over real distances.
const OPEN_SEA = [-1, 1, 0, 0];

/** A GRID×GRID patch in tile fractions, with a skirt hanging from each edge to hide LOD cracks. */
function tileGeometry() {
  const n = GRID + 1;
  const uvs = [];
  const skirt = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) uvs.push(i / GRID, j / GRID), skirt.push(0);
  const index = [];
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const a = j * n + i;
      index.push(a, a + 1, a + n, a + 1, a + n + 1, a + n);
    }
  }
  const edge = [];
  for (let i = 0; i < GRID; i++) edge.push(i);
  for (let j = 0; j < GRID; j++) edge.push(j * n + GRID);
  for (let i = GRID; i > 0; i--) edge.push(GRID * n + i);
  for (let j = GRID; j > 0; j--) edge.push(j * n);
  const first = uvs.length / 2;
  for (const v of edge) uvs.push(uvs[v * 2], uvs[v * 2 + 1]), skirt.push(1);
  for (let k = 0; k < edge.length; k++) {
    const a = edge[k];
    const b = edge[(k + 1) % edge.length];
    const sa = first + k;
    const sb = first + ((k + 1) % edge.length);
    index.push(a, sa, b, b, sa, sb);
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((uvs.length / 2) * 3), 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('skirt', new THREE.Float32BufferAttribute(skirt, 1));
  geo.setIndex(index);
  return geo;
}

class Record {
  constructor(key, layerCount) {
    this.key = key;
    this.id = tileId(key);
    /** One per tile layer, in the body's order. */
    this.slots = Array.from({ length: layerCount }, () => ({ state: 'idle', layer: -1 }));
    this.lastUsed = 0;
  }
}

/**
 * Streams cube-sphere tiles and draws the visible ones in a single instanced call.
 * Tiles that are still loading borrow the texels of their nearest loaded ancestor.
 */
export class TiledPlanet {
  /** @param {THREE.WebGPURenderer} renderer */
  /** `layers` is each atlas's depth; `tileLayers` is the body's list of streamed layers. */
  constructor(renderer, { baseUrl, meta, relief, seaLevel = false, layers, tileLayers, lighting, nightLights = null, atmosphere = null, clouds = null, relaxBeyondKm = 500 }) {
    this.lighting = lighting;
    this.nightLights = nightLights;
    this.atmosphere = atmosphere;
    this.clouds = clouds;
    this.relaxBeyondKm = relaxBeyondKm > 0 ? relaxBeyondKm : Infinity;
    this.renderer = renderer;
    this.baseUrl = baseUrl;
    this.meta = meta;
    this.radiusKm = meta.radiusKm;
    this.relief = relief;
    this.seaLevel = seaLevel;
    this.heightRangeKm = drawnHeightRangeKm(meta.heightRangeM, { relief, seaLevel });
    this.tileLayers = tileLayers;
    this.atlases = tileLayers.map((l) => new LayerArray(renderer, { size: l.sizePx, layers, format: l.format }));
    this.colorIndex = tileLayers.findIndex((l) => l.id === 'color');
    this.heightIndex = tileLayers.findIndex((l) => l.id === 'height');
    // The terrain can't draw a tile without colour and height; any other layer is optional.
    this.required = [this.colorIndex, this.heightIndex];
    this.maxLevel = Math.max(...tileLayers.map((l) => l.maxLevel));
    this.sunDir = undefined;
    this.records = new Map();
    this.frame = 0;
    this.inFlight = 0;
    // Counts GPU uploads, so frame timing can skip frames that include them.
    this.writes = 0;
    this.texelBias = 1;
    // Before a visit's first scene shows, fallback tiles are cut to a few shared coarse ones (see
    // tilesToFetch). The scene clears this at its first fade-in; a body switch starts with it off.
    this.lean = true;
    /** @type {'loading' | 'ready' | 'failed'} */
    this.shadow = 'loading';
    this.stats = { records: 0, requests: 0, bytes: 0, layerBytes: Object.fromEntries(tileLayers.map((l) => [l.id, 0])), selected: 0, drawn: 0, pending: 0, texelBias: 1 };
    this.workers = Array.from({ length: WORKERS }, () => {
      const w = new Worker(new URL('./tile-worker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => this.onLoaded(e.data);
      return w;
    });
    this.nextWorker = 0;
    this.waiters = new Map();

    this.tileAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 4), 4);
    this.layerAttrs = tileLayers.map(() => new THREE.InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 4), 4));
    for (const a of [this.tileAttr, ...this.layerAttrs]) a.setUsage(THREE.DynamicDrawUsage);
    const geo = tileGeometry();
    geo.instanceCount = 0;
    this.geometry = geo;
    this.exaggeration = uniform(relief);
    // Full size from the start and filled in place: the material renders before the map arrives, and
    // swapping in a new texture after that drew banded shadows.
    const shadowMap = new THREE.DataTexture(new Uint16Array(SHADOW_MAP.width * SHADOW_MAP.height), SHADOW_MAP.width, SHADOW_MAP.height, THREE.RedFormat, THREE.HalfFloatType);
    shadowMap.wrapS = THREE.RepeatWrapping;
    shadowMap.magFilter = shadowMap.minFilter = THREE.LinearFilter;
    shadowMap.needsUpdate = true;
    this.shadowSlot = texture(shadowMap);
    this.mesh = new THREE.Mesh(geo, this.buildMaterial());
    this.mesh.frustumCulled = false;
  }

  /** Exaggerated terrain height in km under world-space unit direction `n`, from the coarse shadow map. */
  coarseHeight(n) {
    const lat = asin(n.y);
    const lon = atan(n.z.negate(), n.x);
    const uvMap = vec2(lon.add(Math.PI).div(2 * Math.PI), float(Math.PI / 2).sub(lat).div(Math.PI));
    return this.aboveSea(this.shadowSlot.sample(uvMap).level(0).r).mul(this.exaggeration);
  }

  /** Height in km with the sea held flat at 0, on a body with a sea; heights unchanged otherwise. */
  aboveSea(h) {
    return this.seaLevel ? max(h, 0) : h;
  }

  buildMaterial() {
    const lighting = this.lighting;
    const air = this.atmosphere;
    const R = this.radiusKm;
    const fn = uniformArray(FACES.map((f) => toWorld(f.n)), 'vec3');
    const fu = uniformArray(FACES.map((f) => toWorld(f.u)), 'vec3');
    const fv = uniformArray(FACES.map((f) => toWorld(f.v)), 'vec3');
    const aTile = instancedDynamicBufferAttribute(this.tileAttr);
    const aColor = instancedDynamicBufferAttribute(this.layerAttrs[this.colorIndex]);
    const aHeight = instancedDynamicBufferAttribute(this.layerAttrs[this.heightIndex]);
    const heightTex = this.atlases[this.heightIndex].texture;
    const colorTex = this.atlases[this.colorIndex].texture;
    const exaggeration = this.exaggeration;
    const cells = TILES.heightCells;
    const border = TILES.heightBorder;

    const direction = Fn(([tile, f]) => {
      const face = int(round(tile.x));
      const s = tile.y.add(f.x.mul(tile.w));
      const t = tile.z.add(f.y.mul(tile.w));
      return normalize(fn.element(face).add(fu.element(face).mul(tan(s.mul(Math.PI / 4)))).add(fv.element(face).mul(tan(t.mul(Math.PI / 4)))));
    });
    const heightKm = Fn(([hs, f]) => {
      const g = hs.zw.add(f.mul(hs.y));
      const uvH = g.mul(cells).add(border + 0.5).div(HEIGHT_SIZE);
      const h = texture(heightTex, uvH).depth(int(round(hs.x))).level(0).r;
      // An open-sea tile has no height layer (index −1) and lies flat at sea level.
      return (this.seaLevel ? select(hs.x.lessThan(0), float(0), max(h, 0)) : h).mul(exaggeration);
    });
    const surface = Fn(([tile, hs, f]) => direction(tile, f).mul(heightKm(hs, f).add(R)));

    const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    mat.positionNode = Fn(() => {
      const f = uv();
      // Skirts drop by more than any relief step between neighbouring LODs.
      const drop = attribute('skirt', 'float').mul(aTile.w.mul(R * 0.02).add(0.5));
      return direction(aTile, f).mul(heightKm(aHeight, f).add(R).sub(drop));
    })();

    const lights = this.buildLights();
    const vF = varying(uv());
    const vTile = varying(aTile);
    const vColor = varying(aColor);
    const vHeight = varying(aHeight);
    const shadowTex = this.shadowSlot;

    const shadowHeight = (lat, lon) => {
      const u = lon.add(Math.PI).div(2 * Math.PI);
      const v = float(Math.PI / 2).sub(lat).div(Math.PI);
      return this.aboveSea(shadowTex.sample(vec2(u, v)).level(0).r).mul(exaggeration);
    };

    mat.colorNode = Fn(() => {
      const f = vF;
      const uvC = vColor.zw.add(f.mul(vColor.y));
      const albedo = texture(colorTex, uvC).depth(int(round(vColor.x))).rgb;

      const step = float(1 / cells).div(vHeight.y);
      const ds = vec2(step, 0);
      const dt = vec2(0, step);
      const dPds = surface(vTile, vHeight, f.add(ds)).sub(surface(vTile, vHeight, f.sub(ds)));
      const dPdt = surface(vTile, vHeight, f.add(dt)).sub(surface(vTile, vHeight, f.sub(dt)));
      const N = normalize(cross(dPds, dPdt));

      const n = normalize(positionWorld);
      const lat = asin(n.y);
      const lon = atan(n.z.negate(), n.x);
      const s = lighting.sunDir;
      const ndl = max(dot(N, s), 0);
      const su = dot(n, s);

      // A peak can see the Sun below the local horizon: exaggerated relief on the Moon reaches about
      // 25 km, whose horizon dips about 10°. Below that the ground is in the planet's own shadow,
      // which haze hides on Mars but an airless body shows as lit steep slopes.
      const shadow = float(1).toVar();
      If(su.lessThan(-0.2), () => shadow.assign(0));
      If(su.greaterThanEqual(-0.2).and(ndl.greaterThan(0)).and(lighting.shadows.greaterThan(0.5)), () => {
        const east = vec3(sin(lon).negate(), 0, cos(lon).negate());
        const north = vec3(sin(lat).negate().mul(cos(lon)), cos(lat), sin(lat).mul(sin(lon)));
        const se = dot(s, east);
        const sn = dot(s, north);
        const hl = max(sqrt(se.mul(se).add(sn.mul(sn))), 1e-4);
        const tanE = su.div(hl);
        // The march starts from the same coarse map it samples, so it never self-shadows.
        const h0 = shadowHeight(lat, lon).add(0.05);
        const cosLat = max(cos(lat), 0.02);
        const d = float(2).toVar();
        Loop({ start: 0, end: SHADOW_STEPS, name: 'k' }, () => {
          const latK = lat.add(sn.div(hl).mul(d).div(R));
          const lonK = lon.add(se.div(hl).mul(d).div(cosLat.mul(R)));
          const terrain = shadowHeight(latK, lonK);
          const ray = h0.add(tanE.mul(d)).sub(d.mul(d).div(2 * R));
          const penumbra = d.mul(lighting.sunDiameter).add(0.15);
          shadow.assign(min(shadow, clamp(ray.sub(terrain).div(penumbra).mul(0.5).add(0.5), 0, 1)));
          d.mulAssign(SHADOW_GROWTH);
        });
      });

      let direct = albedo.mul(lighting.sunColor).mul(lighting.sunIntensity).mul(ndl).mul(shadow);
      if (air) {
        // Read at the reference radius: exaggerated peaks would otherwise climb out of the haze.
        const depth = air.opticalDepth(float(R), max(su, 0)).mul(vec3(...(air.model.groundHaze ?? [1, 1, 1])));
        // The share of the Sun's disc above a flat horizon.
        const risen = clamp(su.div(lighting.sunDiameter).add(0.5), 0, 1);
        direct = direct.mul(exp(depth.negate())).mul(risen);
      }
      if (this.clouds) direct = direct.mul(this.clouds.shadowAt(positionWorld, s));
      const sky = albedo.mul(lighting.skyTint).mul(lighting.ambient).mul(smoothstep(-0.2, 0.25, su));
      const ground = direct.add(sky);
      return vec4(lights ? ground.add(lights(f, n, su)) : ground, 1);
    })();
    return mat;
  }

  /**
   * City lights as emission, or null on a body without them. They fade in over the twilight band of
   * su (sine of the Sun's elevation). The atmosphere shell, blended over the terrain, already dims
   * everything by the mean of its view throughput, which includes the clouds; this adds only the
   * colour of that transmittance, so lights near the limb redden without being dimmed twice.
   */
  buildLights() {
    const i = this.tileLayers.findIndex((l) => l.id === 'lights');
    const cfg = this.nightLights;
    if (i < 0 || !cfg) return null;
    const vLights = varying(instancedDynamicBufferAttribute(this.layerAttrs[i]));
    const tex = this.atlases[i].texture;
    const air = this.atmosphere;
    const R = this.radiusKm;
    return (f, n, su) => {
      // Sampled outside any branch so its mip comes from screen derivatives; a tile with no lights loaded reads 0.
      const grey = texture(tex, vLights.zw.add(f.mul(vLights.y))).depth(int(round(max(vLights.x, 0)))).r;
      const light = select(vLights.x.lessThan(0), float(0), pow(grey, LIGHTS_GAMMA));
      const night = smoothstep(cfg.fadeSin[1], cfg.fadeSin[0], su).oneMinus();
      let glow = vec3(...cfg.color).mul(cfg.intensity).mul(light).mul(night);
      if (air) {
        const t = air.transmittance(float(R), max(dot(n, normalize(cameraPosition.sub(positionWorld))), 0));
        glow = glow.mul(t.div(max(t.x.add(t.y).add(t.z).div(3), 1e-4)));
      }
      return glow;
    };
  }

  /** Loads the coarse shadow map. Resolves either way; without it the map stays zero, which reads as flat ground. */
  async init() {
    const shadow = await this.request({ format: 'height', url: `${this.baseUrl}/${SHADOW_MAP.path}`, shape: SHADOW_MAP });
    if (shadow.error || shadow.missing) {
      this.shadow = 'failed';
      console.warn(`No shadow map at ${this.baseUrl}/${SHADOW_MAP.path}; terrain casts no long shadows.`, shadow.error ?? '');
      return;
    }
    const tex = this.shadowSlot.value;
    tex.image.data = shadow.data;
    tex.needsUpdate = true;
    this.stats.bytes += shadow.bytes;
    this.stats.layerBytes[this.tileLayers[this.heightIndex].id] += shadow.bytes;
    this.shadow = 'ready';
  }

  request(msg) {
    const id = `${msg.format}:${msg.url}`;
    return new Promise((resolve) => {
      this.waiters.set(id, resolve);
      this.workers[this.nextWorker++ % WORKERS].postMessage({ ...msg, id });
    });
  }

  record(key) {
    const id = tileId(key);
    let r = this.records.get(id);
    if (!r) this.records.set(id, (r = new Record(key, this.tileLayers.length)));
    return r;
  }

  fetchTile(rec, i) {
    const tileLayer = this.tileLayers[i];
    const slot = rec.slots[i];
    slot.state = 'loading';
    this.inFlight++;
    this.stats.requests++;
    const url = `${this.baseUrl}/${layerPath(tileLayer, rec.key)}`;
    this.request({ format: tileLayer.format, url }).then((out) => {
      this.inFlight--;
      this.stats.bytes += out.bytes ?? 0;
      this.stats.layerBytes[tileLayer.id] += out.bytes ?? 0;
      if (out.error || out.missing) {
        slot.state = 'missing';
        return;
      }
      const array = this.atlases[i];
      let layer = array.alloc();
      if (layer < 0) layer = this.evict(i);
      if (layer < 0) {
        out.bitmap?.close();
        slot.state = 'idle';
        return;
      }
      if (out.bitmap) array.writeImage(layer, out.bitmap);
      else array.write(layer, out.levels ?? [out.data]);
      this.writes++;
      slot.layer = layer;
      slot.state = 'ready';
      if (i === this.heightIndex) rec.heightRange = [out.minKm, out.maxKm];
    });
  }

  onLoaded(data) {
    const resolve = this.waiters.get(data.id);
    this.waiters.delete(data.id);
    resolve?.(data);
  }

  /** Frees the least recently used atlas layer of tile layer `i` that this frame doesn't draw from. */
  evict(i) {
    let victim = null;
    for (const r of this.records.values()) {
      const slot = r.slots[i];
      if (slot.state !== 'ready' || r.lastUsed >= this.frame || r.key.level <= 1) continue;
      if (!victim || r.lastUsed < victim.lastUsed) victim = r;
    }
    if (!victim) return -1;
    const slot = victim.slots[i];
    const layer = slot.layer;
    slot.state = 'idle';
    slot.layer = -1;
    return layer;
  }

  /** Nearest loaded ancestor-or-self for tile layer `i`, with the uv transform into it. */
  source(rec, i) {
    let k = rec.key;
    let r = rec;
    while (!r || r.slots[i].state !== 'ready') {
      const p = parent(k);
      if (!p) return null;
      k = p;
      r = this.records.get(tileId(k));
    }
    r.lastUsed = this.frame;
    const d = rec.key.level - k.level;
    const scale = 1 / 2 ** d;
    return [r.slots[i].layer, scale, (rec.key.x - (k.x << d)) * scale, (rec.key.y - (k.y << d)) * scale];
  }

  /**
   * @param {{ position: number[], forward: number[], up: number[] }} pose body frame, km
   * @param {{ fovYRad: number, aspect: number, viewportHeightPx: number }} view
   * @param {number[]} [sunDir] unit vector to the Sun, body frame; layers with a Sun rule need it
   */
  update(pose, view, sunDir) {
    this.frame++;
    this.sunDir = sunDir;
    const cam = { ...pose, ...view };
    const opts = { radiusKm: this.radiusKm, heightRangeKm: this.heightRangeKm, tilePx: TILES.colorPx, maxLevel: this.maxLevel, maxTexelPx: this.texelBias, relaxBeyondKm: this.relaxBeyondKm };
    let selected = selectTiles(cam, opts);
    // Keep the working set well inside the atlas; coarsen evenly if a huge viewport asks for too much.
    const budget = this.atlases[this.colorIndex].layers * 0.6;
    while (selected.length * 1.3 > budget && opts.maxTexelPx < 8) {
      opts.maxTexelPx *= 1.25;
      selected = selectTiles(cam, opts);
    }
    this.stats.texelBias = opts.maxTexelPx;

    for (const k of tilesToFetch(selected, { lean: this.lean })) this.record(k).lastUsed = this.frame;
    // Pending counts only slots a layer wants now, so a layer its rule skips never holds up a poster.
    const idleSlots = new Map();
    this.tileLayers.forEach((tileLayer, i) => {
      for (const k of layerTilesFor(selected, tileLayer, { lean: this.lean, sunDir: this.sunDir, flatOcean: this.meta.flatOcean })) {
        const t = this.record(k);
        t.lastUsed = this.frame;
        if (t.slots[i].state !== 'idle') continue;
        if (!idleSlots.has(t)) idleSlots.set(t, new Set());
        idleSlots.get(t).add(i);
      }
    });
    const idle = [...idleSlots.keys()];
    this.stats.pending = idle.length;
    this.stats.inFlight = this.inFlight;
    if (this.inFlight < MAX_IN_FLIGHT && idle.length) {
      const dist = new Map(selected.map((s) => [s.id, s.distanceKm]));
      idle.sort((a, b) => a.key.level - b.key.level || (dist.get(a.id) ?? 0) - (dist.get(b.id) ?? 0));
      for (const r of idle) {
        if (this.inFlight >= MAX_IN_FLIGHT) break;
        for (const i of [...idleSlots.get(r)].sort((a, b) => a - b)) this.fetchTile(r, i);
      }
    }

    let n = 0;
    const T = this.tileAttr.array;
    for (const s of selected) {
      if (n >= MAX_INSTANCES) break;
      const rec = this.records.get(s.id);
      const openSea = this.seaLevel && isOpenSea(s.key, this.meta.flatOcean);
      const sources = this.tileLayers.map((_, i) => (openSea && i === this.heightIndex ? OPEN_SEA : this.source(rec, i)));
      if (this.required.some((i) => !sources[i])) continue;
      const size = 2 / 2 ** s.key.level;
      T.set([s.key.face, -1 + s.key.x * size, -1 + s.key.y * size, size], n * 4);
      sources.forEach((src, i) => this.layerAttrs[i].array.set(src ?? NO_DATA, n * 4));
      n++;
    }
    this.geometry.instanceCount = n;
    for (const a of [this.tileAttr, ...this.layerAttrs]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * 4);
      a.needsUpdate = true;
    }
    this.stats.selected = selected.length;
    this.stats.drawn = n;
    this.selected = selected;
    if (this.frame % 120 === 0) this.prune();
  }

  prune() {
    for (const [id, r] of this.records) {
      if (r.key.level <= 1 || this.frame - r.lastUsed < RECORD_TTL_FRAMES) continue;
      const busy = (slot) => slot.state === 'loading' || slot.state === 'ready';
      if (r.slots.some(busy)) continue;
      this.records.delete(id);
    }
    this.stats.records = this.records.size;
  }

  /** True once nearly every selected tile draws from its own texels. */
  settled() {
    if (!this.selected?.length) return false;
    const done = (slot) => slot.state === 'ready' || slot.state === 'missing';
    let ready = 0;
    for (const s of this.selected) {
      const r = this.records.get(s.id);
      if (r && this.tileLayers.every((tileLayer, i) => {
        const k = layerTile(s.key, tileLayer);
        if (!layerWants(k, tileLayer, this.sunDir, this.meta.flatOcean)) return true;
        const t = k === s.key ? r : this.records.get(tileId(k));
        return t && done(t.slots[i]);
      })) ready++;
    }
    return ready >= this.selected.length * SETTLED_FRACTION;
  }

  setRelief(relief) {
    this.relief = relief;
    this.exaggeration.value = relief;
  }

  dispose() {
    for (const w of this.workers) w.terminate();
    for (const a of this.atlases) a.dispose();
    this.geometry.dispose();
    this.mesh.material.dispose();
  }
}
