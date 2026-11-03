import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, asin, atan, attribute, clamp, cos, cross, dot, exp, float, instancedDynamicBufferAttribute, int, max, min,
  normalize, positionWorld, round, sin, smoothstep, sqrt, tan, texture, uniform, uniformArray, uv, varying, vec2, vec3, vec4,
} from 'three/tsl';
import { FACES, parent, tileId } from '../tiles/cube.ts';
import { selectTiles, tilesToFetch } from '../tiles/select.ts';
import { TILES, HEIGHT_SIZE, SHADOW_MAP, colorPath, heightPath } from '../tiles/layout.ts';
import { LayerArray } from './tile-atlas.js';
import { lighting, toWorld } from './terrain.js';
import { shadowGrowth } from '../quality.ts';

const GRID = 32;
const MAX_INSTANCES = 4096;
// HTTP/2 multiplexes these over one connection; fewer would leave a high-latency link idle.
const MAX_IN_FLIGHT = 32;
// Over a network the camera keeps moving while tiles arrive, so a few edge tiles are always
// in flight; they draw from their parent meanwhile.
const SETTLED_FRACTION = 0.95;
// Records for tiles without GPU data are dropped after this many unused frames, so a long
// session that keeps flying over new ground doesn't accumulate them.
const RECORD_TTL_FRAMES = 600;
const WORKERS = 4;

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
  constructor(key) {
    this.key = key;
    this.id = tileId(key);
    this.color = { state: 'idle', layer: -1 };
    this.height = { state: 'idle', layer: -1 };
    this.lastUsed = 0;
  }
}

/**
 * Streams cube-sphere tiles and draws the visible ones in a single instanced call.
 * Tiles that are still loading borrow the texels of their nearest loaded ancestor.
 */
export class TiledPlanet {
  /** @param {THREE.WebGPURenderer} renderer */
  constructor(renderer, { baseUrl, meta, relief, layers, relaxBeyondKm = 500, shadowSteps = 44 }) {
    this.relaxBeyondKm = relaxBeyondKm > 0 ? relaxBeyondKm : Infinity;
    this.renderer = renderer;
    this.baseUrl = baseUrl;
    this.meta = meta;
    this.radiusKm = meta.radiusKm;
    this.relief = relief;
    this.heightRangeKm = [(meta.heightRangeM[0] / 1000) * relief, (meta.heightRangeM[1] / 1000) * relief];
    this.colors = new LayerArray(renderer, { size: TILES.colorPx, layers, kind: 'color' });
    this.heights = new LayerArray(renderer, { size: HEIGHT_SIZE, layers, kind: 'height' });
    this.records = new Map();
    this.frame = 0;
    this.inFlight = 0;
    // Counts GPU uploads, so frame timing can skip frames that include them.
    this.writes = 0;
    this.texelBias = 1;
    this.stats = { records: 0, requests: 0, bytes: 0, colorBytes: 0, heightBytes: 0, selected: 0, drawn: 0, pending: 0, texelBias: 1 };
    this.workers = Array.from({ length: WORKERS }, () => {
      const w = new Worker(new URL('./tile-worker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => this.onLoaded(e.data);
      return w;
    });
    this.nextWorker = 0;
    this.waiters = new Map();

    this.tileAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 4), 4);
    this.colorAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 4), 4);
    this.heightAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 4), 4);
    for (const a of [this.tileAttr, this.colorAttr, this.heightAttr]) a.setUsage(THREE.DynamicDrawUsage);
    const geo = tileGeometry();
    geo.instanceCount = 0;
    this.geometry = geo;
    this.exaggeration = uniform(relief);
    this.shadowSteps = uniform(shadowSteps, 'int');
    this.shadowGrowth = uniform(shadowGrowth(shadowSteps));
    this.shadowSlot = texture(new THREE.DataTexture(new Uint16Array(1), 1, 1, THREE.RedFormat, THREE.HalfFloatType));
    this.mesh = new THREE.Mesh(geo, this.buildMaterial());
    this.mesh.frustumCulled = false;
  }

  buildMaterial() {
    const R = this.radiusKm;
    const fn = uniformArray(FACES.map((f) => toWorld(f.n)), 'vec3');
    const fu = uniformArray(FACES.map((f) => toWorld(f.u)), 'vec3');
    const fv = uniformArray(FACES.map((f) => toWorld(f.v)), 'vec3');
    const aTile = instancedDynamicBufferAttribute(this.tileAttr);
    const aColor = instancedDynamicBufferAttribute(this.colorAttr);
    const aHeight = instancedDynamicBufferAttribute(this.heightAttr);
    const heightTex = this.heights.texture;
    const colorTex = this.colors.texture;
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
      return texture(heightTex, uvH).depth(int(round(hs.x))).level(0).r.mul(exaggeration);
    });
    const surface = Fn(([tile, hs, f]) => direction(tile, f).mul(heightKm(hs, f).add(R)));

    const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    mat.positionNode = Fn(() => {
      const f = uv();
      // Skirts drop by more than any relief step between neighbouring LODs.
      const drop = attribute('skirt', 'float').mul(aTile.w.mul(R * 0.02).add(0.5));
      return direction(aTile, f).mul(heightKm(aHeight, f).add(R).sub(drop));
    })();

    const vF = varying(uv());
    const vTile = varying(aTile);
    const vColor = varying(aColor);
    const vHeight = varying(aHeight);
    const shadowTex = this.shadowSlot;

    const shadowHeight = (lat, lon) => {
      const u = lon.add(Math.PI).div(2 * Math.PI);
      const v = float(Math.PI / 2).sub(lat).div(Math.PI);
      return shadowTex.sample(vec2(u, v)).level(0).r.mul(exaggeration);
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

      const shadow = float(1).toVar();
      If(su.greaterThan(-0.08).and(ndl.greaterThan(0)).and(lighting.shadows.greaterThan(0.5)), () => {
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
        Loop({ start: int(0), end: this.shadowSteps, type: 'int', condition: '<', name: 'k' }, () => {
          const latK = lat.add(sn.div(hl).mul(d).div(R));
          const lonK = lon.add(se.div(hl).mul(d).div(cosLat.mul(R)));
          const terrain = shadowHeight(latK, lonK);
          const ray = h0.add(tanE.mul(d)).sub(d.mul(d).div(2 * R));
          const penumbra = d.mul(0.0061).add(0.15);
          shadow.assign(min(shadow, clamp(ray.sub(terrain).div(penumbra).mul(0.5).add(0.5), 0, 1)));
          d.mulAssign(this.shadowGrowth);
        });
      });

      const airmass = float(1).div(max(su.add(0.035), 0.02));
      const trans = exp(vec3(0.85, 1.0, 1.25).mul(lighting.opticalDepth).mul(airmass).negate());
      const direct = albedo.mul(lighting.sunColor).mul(lighting.sunIntensity).mul(ndl).mul(shadow).mul(trans);
      const sky = albedo.mul(vec3(1, 0.72, 0.5)).mul(lighting.ambient).mul(smoothstep(-0.2, 0.25, su));
      return vec4(direct.add(sky), 1);
    })();
    return mat;
  }

  async init() {
    const shadow = await this.request({ kind: 'height', url: `${this.baseUrl}/${SHADOW_MAP.path}`, shape: SHADOW_MAP });
    const tex = new THREE.DataTexture(shadow.data, SHADOW_MAP.width, SHADOW_MAP.height, THREE.RedFormat, THREE.HalfFloatType);
    tex.wrapS = THREE.RepeatWrapping;
    tex.magFilter = tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    this.shadowSlot.value = tex;
    this.stats.bytes += shadow.bytes;
    this.stats.heightBytes += shadow.bytes;
  }

  request(msg) {
    const id = `${msg.kind}:${msg.url}`;
    return new Promise((resolve) => {
      this.waiters.set(id, resolve);
      this.workers[this.nextWorker++ % WORKERS].postMessage({ ...msg, id });
    });
  }

  record(key) {
    const id = tileId(key);
    let r = this.records.get(id);
    if (!r) this.records.set(id, (r = new Record(key)));
    return r;
  }

  fetchTile(rec, kind) {
    const slot = rec[kind];
    slot.state = 'loading';
    this.inFlight++;
    this.stats.requests++;
    const url = `${this.baseUrl}/${kind === 'color' ? colorPath(rec.key) : heightPath(rec.key)}`;
    this.request({ kind, url }).then((out) => {
      this.inFlight--;
      this.stats.bytes += out.bytes;
      this.stats[kind === 'color' ? 'colorBytes' : 'heightBytes'] += out.bytes;
      if (out.error || out.missing) {
        slot.state = 'missing';
        return;
      }
      const array = kind === 'color' ? this.colors : this.heights;
      let layer = array.alloc();
      if (layer < 0) layer = this.evict(kind);
      if (layer < 0) {
        slot.state = 'idle';
        return;
      }
      array.write(layer, out.levels ?? [out.data]);
      this.writes++;
      slot.layer = layer;
      slot.state = 'ready';
      if (kind === 'height') rec.heightRange = [out.minKm, out.maxKm];
    });
  }

  onLoaded(data) {
    const resolve = this.waiters.get(data.id);
    this.waiters.delete(data.id);
    resolve?.(data);
  }

  /** Frees the least recently used layer that this frame doesn't draw from. */
  evict(kind) {
    let victim = null;
    for (const r of this.records.values()) {
      const slot = r[kind];
      if (slot.state !== 'ready' || r.lastUsed >= this.frame || r.key.level <= 1) continue;
      if (!victim || r.lastUsed < victim.lastUsed) victim = r;
    }
    if (!victim) return -1;
    const slot = victim[kind];
    const layer = slot.layer;
    slot.state = 'idle';
    slot.layer = -1;
    return layer;
  }

  /** Nearest loaded ancestor-or-self for one kind, with the uv transform into it. */
  source(rec, kind) {
    let k = rec.key;
    let r = rec;
    while (!r || r[kind].state !== 'ready') {
      const p = parent(k);
      if (!p) return null;
      k = p;
      r = this.records.get(tileId(k));
    }
    r.lastUsed = this.frame;
    const d = rec.key.level - k.level;
    const scale = 1 / 2 ** d;
    return [r[kind].layer, scale, (rec.key.x - (k.x << d)) * scale, (rec.key.y - (k.y << d)) * scale];
  }

  /**
   * @param {{ position: number[], forward: number[], up: number[] }} pose body frame, km
   * @param {{ fovYRad: number, aspect: number, viewportHeightPx: number }} view
   */
  update(pose, view) {
    this.frame++;
    const cam = { ...pose, ...view };
    const opts = { radiusKm: this.radiusKm, heightRangeKm: this.heightRangeKm, tilePx: TILES.colorPx, maxLevel: TILES.maxLevel, maxTexelPx: this.texelBias, relaxBeyondKm: this.relaxBeyondKm };
    let selected = selectTiles(cam, opts);
    // Keep the working set well inside the atlas; coarsen evenly if a huge viewport asks for too much.
    const budget = this.colors.layers * 0.6;
    while (selected.length * 1.3 > budget && opts.maxTexelPx < 8) {
      opts.maxTexelPx *= 1.25;
      selected = selectTiles(cam, opts);
    }
    this.stats.texelBias = opts.maxTexelPx;

    const wanted = tilesToFetch(selected).map((k) => this.record(k));
    for (const r of wanted) r.lastUsed = this.frame;
    const idle = wanted.filter((r) => r.color.state === 'idle' || r.height.state === 'idle');
    this.stats.pending = idle.length;
    if (this.inFlight < MAX_IN_FLIGHT && idle.length) {
      const dist = new Map(selected.map((s) => [s.id, s.distanceKm]));
      idle.sort((a, b) => a.key.level - b.key.level || (dist.get(a.id) ?? 0) - (dist.get(b.id) ?? 0));
      for (const r of idle) {
        if (this.inFlight >= MAX_IN_FLIGHT) break;
        if (r.color.state === 'idle') this.fetchTile(r, 'color');
        if (r.height.state === 'idle') this.fetchTile(r, 'height');
      }
    }

    let n = 0;
    const T = this.tileAttr.array;
    const C = this.colorAttr.array;
    const H = this.heightAttr.array;
    for (const s of selected) {
      if (n >= MAX_INSTANCES) break;
      const rec = this.records.get(s.id);
      const c = this.source(rec, 'color');
      const h = this.source(rec, 'height');
      if (!c || !h) continue;
      const size = 2 / 2 ** s.key.level;
      T.set([s.key.face, -1 + s.key.x * size, -1 + s.key.y * size, size], n * 4);
      C.set(c, n * 4);
      H.set(h, n * 4);
      n++;
    }
    this.geometry.instanceCount = n;
    for (const a of [this.tileAttr, this.colorAttr, this.heightAttr]) {
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
      if (busy(r.color) || busy(r.height)) continue;
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
      if (r && done(r.color) && done(r.height)) ready++;
    }
    return ready >= this.selected.length * SETTLED_FRACTION;
  }

  setShadowSteps(steps) {
    this.shadowSteps.value = steps;
    this.shadowGrowth.value = shadowGrowth(steps);
  }

  setRelief(relief) {
    this.relief = relief;
    this.exaggeration.value = relief;
  }

  dispose() {
    for (const w of this.workers) w.terminate();
    this.colors.dispose();
    this.heights.dispose();
    this.geometry.dispose();
    this.mesh.material.dispose();
  }
}
