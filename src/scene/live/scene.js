import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { toWorld, createLighting } from './terrain.js';
import { TiledPlanet } from './planet.js';
import { orbitCameraPose } from '../camera.ts';
import { createAtmosphere } from './atmosphere.js';
import { createStars } from './stars.js';
import { createSun } from './sun.js';
import { bodyFrame, vec } from '../ephemeris';
import { sample } from '../orbit';
import { chooseShot, dawnDusk, orbitalSunrise, featureFlyover, seededRandom, wantsReshoot } from '../shots';
import { bodyById } from '../bodies.ts';
import { telemetryParts } from '../telemetry';
import { Governor, initialTier, renderPixelRatio, tier as tierByName } from '../quality.ts';
import { solveFraming } from '../composition.ts';

const DEG = Math.PI / 180;
// Camera defaults. Altitude comes from the body. Tilt (degrees below the horizon beyond the
// geometric dip) and roll come from the framing solver for each viewport unless a preview URL sets them.
export const CAMERA_DEFAULTS = { fovDeg: 50 };
// Where the hero text sits when the page has none to measure, as viewport fractions.
const DEFAULT_TEXT_BOX = { left: 0.06, right: 0.55, top: 0.12, bottom: 0.42 };
const DEFAULT_HEADER_BOTTOM = 0.07;
// Telemetry items hidden on narrow screens, matching the poster readout.
const WIDE_FROM = 4;

function buildShot(body, kind, now, altKm, rand, featureId) {
  const o = { body, altKm, rand };
  const feature = body.features.find((f) => f.id === featureId);
  if (feature) return featureFlyover(now, { ...o, features: [feature], anySun: true });
  if (kind === 'dawn-dusk') return dawnDusk(now, o);
  if (kind === 'orbital-sunrise') return orbitalSunrise(now, o);
  if (kind === 'feature-flyover') return featureFlyover(now, o) ?? dawnDusk(now, o);
  return chooseShot(now, o);
}

/**
 * Starts the live scene of one body inside `host`.
 * @param {HTMLElement} host
 * Resolves to null when this machine should get the poster instead.
 * @param {{ dataUrl: string, body?: string, settleTimeoutMs?: number, holdGovernor?: boolean, startTier?: import('../quality.ts').TierName, shot?: string | null, timeScale?: number, forceWebGL?: boolean, telemetry?: HTMLElement | null, onFirstFrame?: () => void, onLost?: () => void, farKm?: number, altKm?: number, tiltDeg?: number, rollDeg?: number, fovDeg?: number, tier?: import('../quality.ts').TierName, at?: Date, seed?: number, feature?: string | null, scale?: number, skip?: number, layout?: () => { text: import('../composition.ts').Box, headerBottom: number } | null }} opts
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
  const body = bodyById(opts.body);
  const cam = { altKm: opts.altKm ?? body.altKm, fovDeg: opts.fovDeg ?? CAMERA_DEFAULTS.fovDeg, tiltDeg: 0, rollDeg: 0 };
  const frameView = () => {
    const page = opts.layout?.() ?? { text: DEFAULT_TEXT_BOX, headerBottom: DEFAULT_HEADER_BOTTOM };
    const solved = solveFraming({ radiusKm: body.radiusKm, glowKm: body.glowKm, altKm: cam.altKm, fovDeg: cam.fovDeg, aspect: innerWidth / innerHeight, ...page });
    cam.tiltDeg = opts.tiltDeg ?? solved.tiltDeg;
    cam.rollDeg = opts.rollDeg ?? solved.rollDeg;
  };
  frameView();
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
  // A switch starts at the tier the governor had already settled on for this machine.
  const autoTier = initialTier(hints);
  const startTier = opts.tier ?? (autoTier !== 'poster' && opts.startTier ? opts.startTier : autoTier);
  if (startTier === 'poster') {
    renderer.dispose();
    return null;
  }
  let tier = tierByName(startTier);
  // `scale` is a preview override for comparing render resolutions on one screen.
  const pixelRatio = (t) => (opts.scale ? Math.min(devicePixelRatio, opts.scale) : renderPixelRatio(t, devicePixelRatio, innerWidth, innerHeight));

  let planet;
  let atmosphere;
  let pipeline;
  let layers;
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
  let reframe = 0;
  const onResize = () => {
    clearTimeout(reframe);
    reframe = setTimeout(frameView, 150);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(pixelRatio(tier));
    renderer.setSize(innerWidth, innerHeight);
  };
  let sun = null;
  const teardown = () => {
    stopped = true;
    renderer.setAnimationLoop(null);
    removeEventListener('resize', onResize);
    clearTimeout(reframe);
    planet?.dispose();
    atmosphere?.dispose();
    sun?.dispose();
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
  renderer.setPixelRatio(pixelRatio(tier));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.domElement.className = 'live-canvas';
  host.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(cam.fovDeg, innerWidth / innerHeight, 0.05, 5e5);

  sun = createSun(body);
  const stars = createStars();
  const lighting = createLighting(body);
  scene.add(sun.object, stars);

  try {
    await loadPlanet();
  } catch (err) {
    teardown();
    throw err;
  }
  // The device can be lost while tiles load; teardown has run, so nothing more may start.
  if (stopped) throw new Error('GPU device lost while the scene was loading');
  async function loadPlanet() {
    const res = await fetch(`${opts.dataUrl}/meta.json`);
    if (!res.ok) throw new Error(`No tiles at ${opts.dataUrl}`);
    const meta = await res.json();
    if (meta.body !== body.id || Math.abs(meta.radiusKm - body.radiusKm) > 1e-6) console.warn(`Tiles at ${opts.dataUrl} are for ${meta.body}, not ${body.id}.`);
    layers = isWebGPU ? gpuLayers ?? 256 : Math.min(WANTED_LAYERS, renderer.backend.gl.getParameter(renderer.backend.gl.MAX_ARRAY_TEXTURE_LAYERS));
    planet = new TiledPlanet(renderer, { baseUrl: opts.dataUrl, meta, relief: body.relief, layers, lighting, relaxBeyondKm: opts.farKm });
    const tiledPlanet = planet;
    [atmosphere] = await Promise.all([
      body.atmosphere ? createAtmosphere({ planetRadius: body.radiusKm, density: body.atmosphere.density, terrainHeight: (n) => tiledPlanet.coarseHeight(n) }) : null,
      planet.init(),
    ]);
    scene.add(planet.mesh);
    if (atmosphere) scene.add(atmosphere.mesh);
  }

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
    renderer.setPixelRatio(pixelRatio(next));
    renderer.setSize(innerWidth, innerHeight);
    state.tier = next.name;
  };

  const wallStart = Date.now();
  const simStart = opts.at?.getTime() ?? wallStart;
  // `skip` starts the clock part-way into the shot, for stills of a chosen moment.
  const simNow = () => new Date(simStart + (opts.skip ?? 0) * 1000 + (Date.now() - wallStart) * timeScale);
  const rand = opts.seed === undefined ? Math.random : seededRandom(opts.seed);
  let shotBuilt = new Date(simStart);
  let shot = buildShot(body, opts.shot, shotBuilt, cam.altKm, rand, opts.feature);
  // A view pinned by the URL (posters, previews) stays put even after it goes dark.
  const pinned = Boolean(opts.at || opts.seed !== undefined || opts.skip || opts.feature);
  const starMatrix = new THREE.Matrix4();

  function frame() {
    const date = simNow();
    const s = sample(shot.orbit, date);
    const f = bodyFrame(body, date);
    const vBody = [vec.dot(s.v, f.x), vec.dot(s.v, f.y), vec.dot(s.v, f.z)];
    const pose = orbitCameraPose(s.rBody, vBody, body.radiusKm, cam.tiltDeg, cam.rollDeg);

    camera.position.copy(toWorld(s.rBody));
    camera.up.copy(toWorld(pose.up));
    camera.lookAt(toWorld(vec.add(s.rBody, pose.forward)));
    planet.update(pose, { fovYRad: cam.fovDeg * DEG, aspect: camera.aspect, viewportHeightPx: renderer.domElement.height });

    const sunW = toWorld(s.sunBody);
    sun.update(camera, sunW);
    lighting.sunDir.value.copy(sunW);
    if (atmosphere) {
      atmosphere.uniforms.sunDir.value.copy(sunW);
      atmosphere.update(camera);
    }
    starMatrix.set(f.x[0], f.x[1], f.x[2], 0, f.z[0], f.z[1], f.z[2], 0, -f.y[0], -f.y[1], -f.y[2], 0, 0, 0, 0, 1);
    stars.matrix.copy(starMatrix);
    stars.matrixWorldNeedsUpdate = true;
    return s;
  }

  // Only the scene on screen writes the readout; during a body switch the incoming one stays quiet.
  let telemetryEl = opts.telemetry ?? null;
  let lastTelemetry = 0;
  function updateTelemetry(s, t) {
    if (!telemetryEl || t - lastTelemetry < 500) return;
    lastTelemetry = t;
    const parts = telemetryParts(s, { body: body.name, relief: body.relief });
    if (timeScale !== 1) parts.push(`t×${timeScale}`);
    // Nodes are updated in place, so the body switch button keeps focus and hover.
    const label = telemetryEl.querySelector('.body-switch');
    if (label) label.textContent = parts.shift();
    const offset = label ? 1 : 0;
    const spans = [...telemetryEl.querySelectorAll(':scope > span')];
    parts.forEach((text, i) => {
      const span = spans[i] ?? telemetryEl.appendChild(document.createElement('span'));
      if (span.textContent !== text) span.textContent = text;
      span.className = i + offset >= WIDE_FROM ? 'wide' : '';
    });
    for (const extra of spans.slice(parts.length)) extra.remove();
    telemetryEl.dataset.poster = '';
    telemetryEl.dataset.shot = shot.kind;
    telemetryEl.title = `Live: ${shot.kind.replace('-', ' ')}${shot.feature ? ` over ${shot.feature.name}` : ''}. Lit by the Sun's real position now, from a real ${Math.round(s.altKm)} km orbit. Relief is exaggerated ${body.relief}×.`;
  }

  let running = true;
  let throttled = false;
  let lastRender = 0;
  let first = true;
  // three.js timestamp queries add up per-pass spans, which overlap on Apple GPUs and read several times high.
  // Submit-to-done time is the frame's real GPU cost whenever the GPU starts the frame idle.
  const gpuTiming = isWebGPU;
  const governor = opts.tier ? null : new Governor(tier.name, gpuTiming ? GPU_LIMITS : CADENCE_LIMITS);
  // While two scenes overlap in a body switch, each sees the other's GPU time as its own load.
  let governorHeld = opts.holdGovernor ?? false;
  const state = {
    frames: 0, body: body.id, shot: shot.kind, backend: hints.backend, gpu: hints.vendor ?? hints.description, canvas: renderer.domElement, layers, tiles: planet.stats, firstFrameMs: 0,
    tier: tier.name, timing: governor ? (gpuTiming ? 'gpu' : 'cadence') : 'forced', gpuMs: 0, gpuLog: [], load: 0, tierChanges: [],
    framing: cam,
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
    if (telemetryEl) telemetryEl.title = 'Paused: the live view was too heavy for this device, so its last frame stays up.';
  };

  let timingBusy = false;
  let lastWrites = 0;
  const measure = (interval) => {
    if (governorHeld) return;
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
    // A long visit, or a tab left in the background, ends up over the night side. Crossfade to a
    // new shot from here, waiting until the new view's tiles are in.
    if (!first && !pinned && !governorHeld && wantsReshoot(shot, shotBuilt, s.date)) {
      if (!resumeStarted) takeSnapshot();
      resumeStarted = performance.now();
      shotBuilt = s.date;
      shot = buildShot(body, opts.shot, shotBuilt, cam.altKm, rand, opts.feature);
      state.shot = shot.kind;
      return;
    }
    if (resumeStarted && (planet.settled() || performance.now() - resumeStarted > RESUME_SETTLE_TIMEOUT_MS)) {
      resumeStarted = 0;
      fadeSnapshot();
    }
    if (first && (planet.settled() || performance.now() - started > (opts.settleTimeoutMs ?? SETTLE_TIMEOUT_MS))) {
      first = false;
      state.firstFrameMs = Math.round(performance.now() - started);
      opts.onFirstFrame?.();
    }
  });

  addEventListener('resize', onResize);

  return {
    state,
    dispose() {
      if (!stopped) teardown();
      dropSnapshot();
    },
    /** Everything this scene has on screen: the live canvas, and a frozen frame over it if there is one. */
    surfaces() {
      return [renderer.domElement, snapshot].filter((el) => el?.isConnected);
    },
    // Stops the scene and frees the GPU, leaving a copy of its last frame in its place for the caller to remove.
    freeze() {
      if (stopped || first) return null;
      takeSnapshot();
      const still = snapshot;
      snapshot = null;
      teardown();
      return still;
    },
    setTelemetry(el) {
      telemetryEl = el;
      lastTelemetry = 0;
    },
    holdGovernor(on) {
      governorHeld = on;
      if (!on) governor?.reset();
    },
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
