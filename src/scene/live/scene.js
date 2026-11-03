import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { TerrainPatch, loadHeightPng, loadColor, toWorld, RADIUS_KM, lighting } from './terrain.js';
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
export const CAMERA_DEFAULTS = { altKm: 380, tiltDeg: 12, fovDeg: 50 };
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
export async function startLiveScene(host, opts) {
  const timeScale = opts.timeScale ?? 1;
  const cam = { altKm: opts.altKm ?? CAMERA_DEFAULTS.altKm, tiltDeg: opts.tiltDeg ?? CAMERA_DEFAULTS.tiltDeg, fovDeg: opts.fovDeg ?? CAMERA_DEFAULTS.fovDeg };
  const renderer = new THREE.WebGPURenderer({ antialias: true, logarithmicDepthBuffer: true, forceWebGL: opts.forceWebGL ?? false });
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
  const [height, color] = await Promise.all([loadHeightPng(`${opts.dataUrl}/mars_height_4k.png`, meta.heightOffset), loadColor(`${opts.dataUrl}/mars_color_8k.jpg`)]);
  const planet = new TerrainPatch({
    height,
    color,
    bounds: { latMin: -90, latMax: 90, lonMin: -180, lonMax: 180, wrap: true },
    segX: 1024,
    segY: 512,
  });
  planet.setExaggeration(RELIEF);
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
    const up = vec.norm(s.rBody);
    const vBody = vec.norm([vec.dot(s.v, f.x), vec.dot(s.v, f.y), vec.dot(s.v, f.z)]);
    const horiz = vec.norm(vec.sub(vBody, vec.scale(up, vec.dot(vBody, up))));
    const down = Math.acos(RADIUS_KM / vec.len(s.rBody)) + cam.tiltDeg * DEG;
    const forward = vec.add(vec.scale(horiz, Math.cos(down)), vec.scale(up, -Math.sin(down)));

    camera.position.copy(toWorld(s.rBody));
    camera.up.copy(toWorld(up));
    camera.lookAt(toWorld(vec.add(s.rBody, forward)));

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
  const state = { frames: 0, shot: shot.kind, backend: renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2', canvas: renderer.domElement };

  renderer.setAnimationLoop((t) => {
    if (!running) return;
    if (throttled && t - lastRender < 66) return;
    lastRender = t;
    const s = frame();
    pipeline.render();
    state.frames++;
    updateTelemetry(s, t);
    if (first) {
      first = false;
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
