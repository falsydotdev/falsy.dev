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
 * @param {{ dataUrl: string, shot?: string | null, timeScale?: number, forceWebGL?: boolean, telemetry?: HTMLElement | null, onFirstFrame?: () => void, altKm?: number, tiltDeg?: number, fovDeg?: number }} opts
 */
// One tile per array layer; 512 layers hold a 4K view with headroom and cost about 180 MB of GPU memory.
const WANTED_LAYERS = 512;
// Show the scene once every visible tile has its own texels, or after this long regardless.
const SETTLE_TIMEOUT_MS = 6000;

async function adapterLayerLimit(forceWebGL) {
  if (forceWebGL || !navigator.gpu) return undefined;
  const adapter = await navigator.gpu.requestAdapter().catch(() => null);
  return adapter ? Math.min(adapter.limits.maxTextureArrayLayers, WANTED_LAYERS) : undefined;
}

export async function startLiveScene(host, opts) {
  const timeScale = opts.timeScale ?? 1;
  const cam = { altKm: opts.altKm ?? CAMERA_DEFAULTS.altKm, tiltDeg: opts.tiltDeg ?? CAMERA_DEFAULTS.tiltDeg, fovDeg: opts.fovDeg ?? CAMERA_DEFAULTS.fovDeg };
  const forceWebGL = opts.forceWebGL ?? false;
  const gpuLayers = await adapterLayerLimit(forceWebGL);
  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    logarithmicDepthBuffer: true,
    forceWebGL,
    requiredLimits: gpuLayers ? { maxTextureArrayLayers: gpuLayers } : undefined,
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.AgXToneMapping;
  await renderer.init();
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
  const planet = new TiledPlanet(renderer, { baseUrl: opts.dataUrl, meta, relief: RELIEF, layers });
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

  renderer.setAnimationLoop((t) => {
    if (!running) return;
    if (throttled && t - lastRender < 66) return;
    lastRender = t;
    const s = frame();
    pipeline.render();
    state.frames++;
    updateTelemetry(s, t);
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
      running = on;
    },
    setThrottled(on) {
      throttled = on;
    },
  };
}
