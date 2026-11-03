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
import { chooseShot, dawnDusk, orbitalSunrise, featureFlyover } from '../shots';
import { telemetryParts } from '../telemetry';

const DEG = Math.PI / 180;
const RELIEF = 2.5;
const HAZE = 0.2;
// Camera defaults. Tilt is degrees below the horizon beyond the geometric dip; it puts the horizon in the upper frame.
export const CAMERA_DEFAULTS = { altKm: 200, tiltDeg: 12, fovDeg: 50 };
// Telemetry items hidden on narrow screens, matching the poster readout.
const WIDE_FROM = 4;

function buildShot(kind, now, altKm) {
  const o = { altKm };
  if (kind === 'dawn-dusk') return dawnDusk(now, o);
  if (kind === 'orbital-sunrise') return orbitalSunrise(now, o);
  if (kind === 'feature-flyover') return featureFlyover(now, o) ?? dawnDusk(now, o);
  return chooseShot(now, o);
}

/**
 * Starts the live Mars scene inside `host`.
 * @param {HTMLElement} host
 * @param {{ dataUrl: string, shot?: string | null, timeScale?: number, forceWebGL?: boolean, telemetry?: HTMLElement | null, onFirstFrame?: () => void, onLost?: () => void, farKm?: number, altKm?: number, tiltDeg?: number, fovDeg?: number }} opts
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
// The camera moves slowly, so 30 fps looks the same as 60 or 120 and spares laptops a hot GPU.
// Past the first screen, the background only peeks out beside content, so it drops to 15.
const FRAME_MS = 1000 / 30;
const THROTTLED_FRAME_MS = 1000 / 15;

async function adapterLayerLimit(forceWebGL) {
  if (forceWebGL || !navigator.gpu) return undefined;
  const adapter = await navigator.gpu.requestAdapter().catch(() => null);
  return adapter ? Math.min(adapter.limits.maxTextureArrayLayers, WANTED_LAYERS) : undefined;
}

export async function startLiveScene(host, opts) {
  const timeScale = opts.timeScale ?? 1;
  const cam = { altKm: opts.altKm ?? CAMERA_DEFAULTS.altKm, tiltDeg: opts.tiltDeg ?? CAMERA_DEFAULTS.tiltDeg, fovDeg: opts.fovDeg ?? CAMERA_DEFAULTS.fovDeg };
  const forceWebGL = opts.forceWebGL ?? false;
  let gpuLayers = await adapterLayerLimit(forceWebGL);
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
  // A lost GPU device (driver reset, tab backgrounded under memory pressure) can't be resumed:
  // stop, release what's left, and let the page fall back to the poster.
  renderer.onDeviceLost = () => {
    renderer.setAnimationLoop(null);
    planet?.dispose();
    renderer.domElement.remove();
    opts.onLost?.();
  };
  let planet;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
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
  const layers = renderer.backend.isWebGPUBackend ? gpuLayers ?? 256 : Math.min(WANTED_LAYERS, renderer.backend.gl.getParameter(renderer.backend.gl.MAX_ARRAY_TEXTURE_LAYERS));
  planet = new TiledPlanet(renderer, { baseUrl: opts.dataUrl, meta, relief: RELIEF, layers, relaxBeyondKm: opts.farKm });
  await planet.init();
  scene.add(planet.mesh);

  const pipeline = new THREE.RenderPipeline(renderer);
  const sceneColor = pass(scene, camera).getTextureNode('output');
  pipeline.outputNode = sceneColor.add(bloom(sceneColor, 0.35, 0.5, 0.9));

  const wallStart = Date.now();
  const simNow = () => new Date(wallStart + (Date.now() - wallStart) * timeScale);
  const shot = buildShot(opts.shot, new Date(wallStart), cam.altKm);
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
  const state = { frames: 0, shot: shot.kind, backend: renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2', canvas: renderer.domElement, layers, tiles: planet.stats, firstFrameMs: 0 };
  const started = performance.now();

  let hiddenAt = 0;
  let snapshot = null;
  let resumeStarted = 0;

  const dropSnapshot = () => {
    if (!snapshot) return;
    snapshot.remove();
    snapshot.width = snapshot.height = 0;
    snapshot = null;
    resumeStarted = 0;
  };

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
    c.style.opacity = '0';
    setTimeout(() => c === snapshot && dropSnapshot(), RESUME_FADE_MS + 100);
  };

  renderer.setAnimationLoop((t) => {
    if (!running) return;
    // 0.9 absorbs rAF jitter so a 120 Hz display renders every 4th vsync, and a 60 Hz one every 2nd.
    if (t - lastRender < (throttled ? THROTTLED_FRAME_MS : FRAME_MS) * 0.9) return;
    lastRender = t;
    const s = frame();
    pipeline.render();
    state.frames++;
    updateTelemetry(s, t);
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

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  return {
    state,
    setRunning(on) {
      if (on === running) return;
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
      throttled = on;
    },
  };
}
