import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { toWorld, RADIUS_KM, lighting } from './terrain.js';
import { TiledPlanet } from './planet.js';
import { orbitCameraPose } from '../camera.ts';
import { createAtmosphere } from './atmosphere.js';
import { createStars } from './stars.js';
import { marsFrame, vec } from '../ephemeris';
import { sample } from '../orbit';
import { chooseShot, dawnDusk, orbitalSunrise, featureFlyover, seededRandom } from '../shots';
import { MARS_FEATURES } from '../features.ts';
import { telemetryParts } from '../telemetry';
import { Governor, initialTier, renderPixelRatio, tier as tierByName } from '../quality.ts';

const DEG = Math.PI / 180;
const RELIEF = 2.5;
const HAZE = 0.2;
// Camera defaults. Tilt is degrees below the horizon beyond the geometric dip; it puts the horizon in the upper frame.
export const CAMERA_DEFAULTS = { altKm: 200, tiltDeg: 12, fovDeg: 50 };
// Telemetry items hidden on narrow screens, matching the poster readout.
const WIDE_FROM = 4;

function buildShot(kind, now, altKm, rand, featureId) {
  const o = { altKm, rand };
  const feature = MARS_FEATURES.find((f) => f.id === featureId);
  if (feature) return featureFlyover(now, { ...o, features: [feature], anySun: true });
  if (kind === 'dawn-dusk') return dawnDusk(now, o);
  if (kind === 'orbital-sunrise') return orbitalSunrise(now, o);
  if (kind === 'feature-flyover') return featureFlyover(now, o) ?? dawnDusk(now, o);
  return chooseShot(now, o);
}

/**
 * Starts the live Mars scene inside `host`.
 * @param {HTMLElement} host
 * Resolves to null when this machine should get the poster instead.
 * @param {{ dataUrl: string, shot?: string | null, timeScale?: number, forceWebGL?: boolean, telemetry?: HTMLElement | null, onFirstFrame?: () => void, onLost?: () => void, farKm?: number, altKm?: number, tiltDeg?: number, fovDeg?: number, tier?: import('../quality.ts').TierName, at?: Date, seed?: number, feature?: string | null }} opts
 */
// One tile per array layer; 512 layers hold a 4K view with headroom and cost about 180 MB of GPU memory.
const WANTED_LAYERS = 512;
// Show the scene once every visible tile has its own texels, or after this long regardless.
const SETTLE_TIMEOUT_MS = 6000;
// After a background tab returns, the orbit and Sun have moved on. Past this gap, the last frame
// stays up while the new view loads underneath, then crossfades away.
const RESUME_SNAPSHOT_AFTER_MS = 2000;
const RESUME_SETTLE_TIMEOUT_MS = 5000;
const RESUME_FADE_MS = 1200;
// Past the first screen, the background only peeks out beside content, so it drops to 15 fps.
const THROTTLED_FRAME_MS = 1000 / 15;
// Load is GPU time over the tier's frame interval; 60% keeps a laptop cool. On WebGL2 it's
// the rendered frame interval over the target, so only clearly missed frames count.
const GPU_LIMITS = { limit: 0.6, giveUpLimit: 0.75 };
const CADENCE_LIMITS = { limit: 1.4, giveUpLimit: 1.4 };

async function probeAdapter(forceWebGL) {
  if (forceWebGL || !navigator.gpu) return {};
  const adapter = await navigator.gpu.requestAdapter().catch(() => null);
  if (!adapter) return {};
  const { vendor, architecture, description } = adapter.info ?? {};
  return { layers: Math.min(adapter.limits.maxTextureArrayLayers, WANTED_LAYERS), info: { vendor, architecture, description } };
}

function webglRenderer(gl) {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
}

export async function startLiveScene(host, opts) {
  const timeScale = opts.timeScale ?? 1;
  const cam = { altKm: opts.altKm ?? CAMERA_DEFAULTS.altKm, tiltDeg: opts.tiltDeg ?? CAMERA_DEFAULTS.tiltDeg, fovDeg: opts.fovDeg ?? CAMERA_DEFAULTS.fovDeg };
  const forceWebGL = opts.forceWebGL ?? false;
  const probe = await probeAdapter(forceWebGL);
  let gpuLayers = probe.layers;
  const makeRenderer = async (layers) => {
    const r = new THREE.WebGPURenderer({
      antialias: true,
      logarithmicDepthBuffer: true,
      forceWebGL,
      requiredLimits: layers ? { maxTextureArrayLayers: layers } : undefined,
    });
    await r.init();
    return r;
  };
  // three.js asks for its own adapter, which can differ from ours on dual-GPU machines.
  const renderer = await makeRenderer(gpuLayers).catch(() => {
    gpuLayers = undefined;
    return makeRenderer(undefined);
  });
  const isWebGPU = renderer.backend.isWebGPUBackend;
  const hints = isWebGPU ? { backend: 'WebGPU', ...probe.info } : { backend: 'WebGL2', description: webglRenderer(renderer.backend.gl) };
  const startTier = opts.tier ?? initialTier(hints);
  if (startTier === 'poster') {
    renderer.dispose();
    return null;
  }
  let tier = tierByName(startTier);

  let planet;
  let pipeline;
  let stopped = false;
  let snapshot = null;
  let resumeStarted = 0;
  const dropSnapshot = () => {
    if (!snapshot) return;
    snapshot.remove();
    snapshot.width = snapshot.height = 0;
    snapshot = null;
    resumeStarted = 0;
  };
  const onResize = () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(renderPixelRatio(tier, devicePixelRatio, innerWidth, innerHeight));
    renderer.setSize(innerWidth, innerHeight);
  };
  const teardown = () => {
    stopped = true;
    renderer.setAnimationLoop(null);
    removeEventListener('resize', onResize);
    planet?.dispose();
    pipeline?.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
  // A lost GPU device (driver reset, tab backgrounded under memory pressure) can't be resumed:
  // stop, release what's left, and let the page fall back to the poster.
  renderer.onDeviceLost = () => {
    if (stopped) return;
    teardown();
    dropSnapshot();
    opts.onLost?.();
  };
  renderer.setPixelRatio(renderPixelRatio(tier, devicePixelRatio, innerWidth, innerHeight));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.domElement.className = 'live-canvas';
  host.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(cam.fovDeg, innerWidth / innerHeight, 0.05, 5e5);

  const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(60, 55, 48) }));
  const stars = createStars();
  const atmosphere = createAtmosphere({ planetRadius: RADIUS_KM });
  atmosphere.uniforms.density.value = HAZE;
  lighting.opticalDepth.value = HAZE * 0.7;
  scene.add(sunDisc, stars, atmosphere.mesh);

  const meta = await (await fetch(`${opts.dataUrl}/meta.json`)).json();
  const layers = isWebGPU ? gpuLayers ?? 256 : Math.min(WANTED_LAYERS, renderer.backend.gl.getParameter(renderer.backend.gl.MAX_ARRAY_TEXTURE_LAYERS));
  planet = new TiledPlanet(renderer, { baseUrl: opts.dataUrl, meta, relief: RELIEF, layers, relaxBeyondKm: opts.farKm });
  await planet.init();
  scene.add(planet.mesh);

  pipeline = new THREE.RenderPipeline(renderer);
  const sceneColor = pass(scene, camera).getTextureNode('output');
  const bloomed = sceneColor.add(bloom(sceneColor, 0.35, 0.5, 0.9));
  pipeline.outputNode = tier.bloom ? bloomed : sceneColor;

  const applyTier = (next) => {
    if (next.bloom !== tier.bloom) {
      pipeline.outputNode = next.bloom ? bloomed : sceneColor;
      pipeline.needsUpdate = true;
    }
    tier = next;
    renderer.setPixelRatio(renderPixelRatio(next, devicePixelRatio, innerWidth, innerHeight));
    renderer.setSize(innerWidth, innerHeight);
    state.tier = next.name;
  };

  const wallStart = Date.now();
  const simStart = opts.at?.getTime() ?? wallStart;
  const simNow = () => new Date(simStart + (Date.now() - wallStart) * timeScale);
  const rand = opts.seed === undefined ? Math.random : seededRandom(opts.seed);
  const shot = buildShot(opts.shot, new Date(simStart), cam.altKm, rand, opts.feature);
  const starMatrix = new THREE.Matrix4();

  function frame() {
    const date = simNow();
    const s = sample(shot.orbit, date);
    const f = marsFrame(date);
    const vBody = [vec.dot(s.v, f.x), vec.dot(s.v, f.y), vec.dot(s.v, f.z)];
    const pose = orbitCameraPose(s.rBody, vBody, RADIUS_KM, cam.tiltDeg);

    camera.position.copy(toWorld(s.rBody));
    camera.up.copy(toWorld(pose.up));
    camera.lookAt(toWorld(vec.add(s.rBody, pose.forward)));
    planet.update(pose, { fovYRad: cam.fovDeg * DEG, aspect: camera.aspect, viewportHeightPx: renderer.domElement.height });

    const sunW = toWorld(s.sunBody);
    sunDisc.position.copy(sunW).multiplyScalar(1e5);
    atmosphere.uniforms.sunDir.value.copy(sunW);
    lighting.sunDir.value.copy(sunW);
    atmosphere.update(camera);
    starMatrix.set(f.x[0], f.x[1], f.x[2], 0, f.z[0], f.z[1], f.z[2], 0, -f.y[0], -f.y[1], -f.y[2], 0, 0, 0, 0, 1);
    stars.matrix.copy(starMatrix);
    stars.matrixWorldNeedsUpdate = true;
    return s;
  }

  let lastTelemetry = 0;
  function updateTelemetry(s, t) {
    if (!opts.telemetry || t - lastTelemetry < 500) return;
    lastTelemetry = t;
    const parts = telemetryParts(s, { body: 'Mars', relief: RELIEF });
    if (timeScale !== 1) parts.push(`t×${timeScale}`);
    opts.telemetry.replaceChildren(
      ...parts.map((text, i) => {
        const span = document.createElement('span');
        span.textContent = text;
        if (i >= WIDE_FROM) span.className = 'wide';
        return span;
      }),
    );
    opts.telemetry.dataset.poster = '';
    opts.telemetry.dataset.shot = shot.kind;
    opts.telemetry.title = `Live: ${shot.kind.replace('-', ' ')}${shot.feature ? ` over ${shot.feature.name}` : ''}. Lit by the Sun's real position now, from a real ${Math.round(s.altKm)} km orbit. Relief is exaggerated ${RELIEF}×.`;
  }

  let running = true;
  let throttled = false;
  let lastRender = 0;
  let first = true;
  // three.js timestamp queries add up per-pass spans, which overlap on Apple GPUs and read several times high.
  // Submit-to-done time is the frame's real GPU cost whenever the GPU starts the frame idle.
  const gpuTiming = isWebGPU;
  const governor = opts.tier ? null : new Governor(tier.name, gpuTiming ? GPU_LIMITS : CADENCE_LIMITS);
  const state = {
    frames: 0, shot: shot.kind, backend: hints.backend, gpu: hints.vendor ?? hints.description, canvas: renderer.domElement, layers, tiles: planet.stats, firstFrameMs: 0,
    tier: tier.name, timing: governor ? (gpuTiming ? 'gpu' : 'cadence') : 'forced', gpuMs: 0, gpuLog: [], load: 0, tierChanges: [],
  };
  const started = performance.now();

  let hiddenAt = 0;

  // Copies the frame just rendered; the canvas contents are only readable within the same task.
  const takeSnapshot = () => {
    dropSnapshot();
    frame();
    pipeline.render();
    const c = document.createElement('canvas');
    c.width = renderer.domElement.width;
    c.height = renderer.domElement.height;
    c.className = 'live-canvas';
    c.setAttribute('aria-hidden', 'true');
    c.getContext('2d')?.drawImage(renderer.domElement, 0, 0);
    renderer.domElement.after(c);
    snapshot = c;
  };

  const fadeSnapshot = () => {
    const c = snapshot;
    if (!c || c.style.opacity === '0') return;
    c.style.transition = `opacity ${RESUME_FADE_MS}ms ease`;
    // A snapshot taken this same frame has no computed style yet, and would vanish without fading.
    getComputedStyle(c).opacity;
    c.style.opacity = '0';
    setTimeout(() => c === snapshot && dropSnapshot(), RESUME_FADE_MS + 100);
  };

  // Stops for good on a machine that can't hold even Low. Once the scene is showing, its last
  // frame stays up instead of switching to a poster of a different place and time.
  const giveUp = () => {
    if (first) {
      teardown();
      dropSnapshot();
      opts.onLost?.();
      return;
    }
    takeSnapshot();
    teardown();
    state.tier = 'frozen';
    if (opts.telemetry) opts.telemetry.title = 'Paused: the live view was too heavy for this device, so its last frame stays up.';
  };

  let timingBusy = false;
  let lastWrites = 0;
  const measure = (interval) => {
    const judge = (load) => {
      if (stopped || !governor) return;
      const verdict = governor.sample(load, !first);
      state.load = governor.lastMedian;
      if (verdict === 'give-up') return giveUp();
      if (verdict !== 'down') return;
      state.tierChanges.push({ to: governor.tier, atMs: Math.round(performance.now() - started), load: governor.lastMedian });
      // Before the first frame shows, nobody sees the change; after, it crossfades like a tab return.
      if (!first) {
        takeSnapshot();
        resumeStarted = performance.now();
      }
      applyTier(tierByName(governor.tier));
    };
    if (!gpuTiming) {
      if (interval > 0) judge(interval / (throttled ? THROTTLED_FRAME_MS : 1000 / tier.fps));
      return;
    }
    // Tile uploads are queued GPU work too, so frames that include them aren't judged.
    if (timingBusy || planet.writes !== lastWrites) {
      lastWrites = planet.writes;
      return;
    }
    timingBusy = true;
    const t0 = performance.now();
    renderer.backend.device.queue.onSubmittedWorkDone().then(() => {
      timingBusy = false;
      const ms = performance.now() - t0;
      state.gpuMs = ms;
      state.gpuLog.push(Math.round(ms * 10) / 10);
      if (state.gpuLog.length > 120) state.gpuLog.shift();
      judge(ms / (1000 / tier.fps));
    }, () => {
      timingBusy = false;
    });
  };

  renderer.setAnimationLoop((t) => {
    if (!running) return;
    // 0.9 absorbs rAF jitter so a 120 Hz display renders every 4th vsync, and a 60 Hz one every 2nd.
    if (t - lastRender < (throttled ? THROTTLED_FRAME_MS : 1000 / tier.fps) * 0.9) return;
    const interval = lastRender ? t - lastRender : 0;
    lastRender = t;
    const s = frame();
    pipeline.render();
    state.frames++;
    updateTelemetry(s, t);
    measure(interval);
    if (stopped) return;
    if (resumeStarted && (planet.settled() || performance.now() - resumeStarted > RESUME_SETTLE_TIMEOUT_MS)) {
      resumeStarted = 0;
      fadeSnapshot();
    }
    if (first && (planet.settled() || performance.now() - started > SETTLE_TIMEOUT_MS)) {
      first = false;
      state.firstFrameMs = Math.round(performance.now() - started);
      opts.onFirstFrame?.();
    }
  });

  addEventListener('resize', onResize);

  return {
    state,
    setRunning(on) {
      if (on === running || stopped) return;
      governor?.reset();
      lastRender = 0;
      if (!on) {
        hiddenAt = performance.now();
        if (!first) takeSnapshot();
      } else if (snapshot) {
        if (performance.now() - hiddenAt > RESUME_SNAPSHOT_AFTER_MS) resumeStarted = performance.now();
        else dropSnapshot();
      }
      running = on;
    },
    setThrottled(on) {
      if (on === throttled) return;
      throttled = on;
      governor?.reset();
      lastRender = 0;
    },
  };
}
