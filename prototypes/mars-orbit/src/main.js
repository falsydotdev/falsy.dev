import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { marsState, nextSunrise, localSolarTime, bodyVector, vec } from './ephemeris.js';
import { TerrainPatch, loadHeightPng, loadColor, toWorld, RADIUS_KM, lighting } from './terrain.js';
import { createAtmosphere } from './atmosphere.js';
import { createStars } from './stars.js';

const DEG = Math.PI / 180;
const OLYMPUS = { lat: 18.65, lon: 226.2 };
const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);

const state = {
  mode: params.get('mode') === 'olympus' ? 'olympus' : 'orbit',
  exaggeration: Number(params.get('exag') ?? 1),
  thickness: Number(params.get('atmo') ?? 1),
  haze: Number(params.get('haze') ?? 0.2),
  dist: Number(params.get('dist') ?? 760),
  alt: Number(params.get('alt') ?? 380),
  lift: Number(params.get('lift') ?? 10),
  orbitAlt: Number(params.get('orbitAlt') ?? 600),
  exposure: Number(params.get('exposure') ?? 1),
  timeScale: Number(params.get('speed') ?? 1),
  timeOffsetH: 0,
  phi: params.has('phi') ? Number(params.get('phi')) : Math.random() * 360,
  heading: params.has('heading') ? Number(params.get('heading')) : 75 + Math.random() * 40,
  yaw: 0,
  pitch: 0,
  hero: params.get('hero') !== '0',
  hud: params.get('hud') !== '0',
};

const renderer = new THREE.WebGPURenderer({ antialias: true, logarithmicDepthBuffer: true, forceWebGL: params.has('webgl') });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = state.exposure;
$('stage').appendChild(renderer.domElement);
await renderer.init();
const backend = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 5e5);

const sunLight = new THREE.DirectionalLight(0xfff1e0, 3.2);
scene.add(sunLight, sunLight.target);
const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(60, 55, 48) }));
scene.add(sunDisc);

const stars = createStars();
scene.add(stars);

const atmosphere = createAtmosphere({ planetRadius: RADIUS_KM });
scene.add(atmosphere.mesh);

const pipeline = new THREE.RenderPipeline(renderer);
const scenePass = pass(scene, camera);
const sceneColor = scenePass.getTextureNode('output');
pipeline.outputNode = sceneColor.add(bloom(sceneColor, 0.35, 0.5, 0.9));

// --- Data -------------------------------------------------------------------
const meta = await (await fetch('data/meta.json')).json();
setStatus('Loading global Mars textures…');
const [globalHeight, globalColor] = await Promise.all([loadHeightPng('data/mars_height_4k.png', meta.heightOffset), loadColor('data/mars_color_8k.jpg')]);
const global = new TerrainPatch({
  height: globalHeight,
  color: globalColor,
  bounds: { latMin: -90, latMax: 90, lonMin: -180, lonMax: 180, wrap: true },
  segX: 1024,
  segY: 512,
  hole: { latMin: meta.region.latMin + 0.05, latMax: meta.region.latMax - 0.05, lonMin: meta.region.lonMin + 0.05, lonMax: meta.region.lonMax - 0.05 },
});
global.holeEnabled.value = 0;
scene.add(global.mesh);

let region = null;
async function ensureRegion() {
  if (region) return;
  setStatus('Loading Olympus Mons close-up data…');
  const [h, c] = await Promise.all([loadHeightPng('data/om_height.png', meta.heightOffset), loadColor('data/om_color.jpg')]);
  region = new TerrainPatch({ height: h, color: c, bounds: meta.region, segX: 896, segY: 768 });
  scene.add(region.mesh);
  setStatus('');
}

function setExaggeration(x) {
  for (const patch of [global, region]) {
    if (!patch || patch.appliedExaggeration === x) continue;
    patch.setExaggeration(x);
    patch.appliedExaggeration = x;
  }
}

// --- Time -------------------------------------------------------------------
const startWall = performance.now();
const fixedDate = params.has('at') ? new Date(params.get('at')) : null;
let baseDate = fixedDate ?? new Date();
let modeSwitched = false;
let sunriseDate = null;
function simDate() {
  const elapsed = ((performance.now() - startWall) / 1000) * state.timeScale;
  return new Date(baseDate.getTime() + (state.timeOffsetH * 3600 + elapsed) * 1000);
}

async function applyMode() {
  // Each mode opens at its own default exaggeration: true scale for A, 3× for B so the
  // volcano reads like the reference image. The slider still overrides both.
  const exag = params.has('exag') && !modeSwitched ? state.exaggeration : state.mode === 'olympus' ? 3 : 1;
  modeSwitched = true;
  state.exaggeration = exag;
  if (state.mode === 'olympus') await ensureRegion();
  setExaggeration(exag);
  if (state.mode === 'olympus') {
    if (!params.has('heading')) state.heading = 85;
    sunriseDate ??= fixedDate ?? nextSunrise(new Date(), OLYMPUS.lat, OLYMPUS.lon, 7);
    baseDate = sunriseDate;
    region.mesh.visible = true;
    global.holeEnabled.value = 1;
  } else {
    if (!params.has('heading')) state.heading = 75 + Math.random() * 40;
    baseDate = fixedDate ?? new Date();
    if (region) region.mesh.visible = false;
    global.holeEnabled.value = 0;
  }
  state.yaw = 0;
  state.pitch = 0;
  syncUi();
}

// --- Camera rig -------------------------------------------------------------
const rotate = (v, axis, a) => vec.add(vec.add(vec.scale(v, Math.cos(a)), vec.scale(vec.cross(axis, v), Math.sin(a))), vec.scale(axis, vec.dot(axis, v) * (1 - Math.cos(a))));

function placeCamera(sun, t) {
  const z = [0, 0, 1];
  let ground;
  let altitude;
  let lookTarget = null;
  if (state.mode === 'orbit') {
    const e1 = vec.norm(vec.cross(sun, z));
    const e2 = vec.norm(vec.cross(sun, e1));
    const phi = (state.phi + t * 0.01) * DEG;
    const onTerminator = vec.add(vec.scale(e1, Math.cos(phi)), vec.scale(e2, Math.sin(phi)));
    ground = vec.norm(vec.add(vec.scale(onTerminator, Math.cos(5 * DEG)), vec.scale(sun, Math.sin(5 * DEG))));
    altitude = state.orbitAlt;
  } else {
    const site = bodyVector(OLYMPUS.lat, OLYMPUS.lon);
    const sunH = vec.norm(vec.add(sun, vec.scale(site, -vec.dot(sun, site))));
    const view = rotate(sunH, site, state.heading * DEG);
    const d = state.dist / RADIUS_KM;
    ground = vec.norm(vec.add(vec.scale(site, Math.cos(d)), vec.scale(view, -Math.sin(d))));
    altitude = state.alt;
    lookTarget = vec.scale(site, RADIUS_KM);
  }

  const up = ground;
  const pos = vec.scale(up, RADIUS_KM + altitude);
  let forward;
  if (lookTarget) {
    forward = vec.norm(vec.add(lookTarget, vec.scale(pos, -1)));
    forward = rotate(forward, up, state.yaw * DEG);
    const r = vec.norm(vec.cross(forward, up));
    forward = rotate(forward, r, state.lift * DEG);
  } else {
    const sunH = vec.norm(vec.add(sun, vec.scale(up, -vec.dot(sun, up))));
    const horiz = rotate(sunH, up, (state.heading + state.yaw) * DEG);
    const dip = Math.acos(RADIUS_KM / (RADIUS_KM + altitude));
    const down = dip + 12 * DEG;
    forward = vec.add(vec.scale(horiz, Math.cos(down)), vec.scale(up, -Math.sin(down)));
  }
  const right = vec.norm(vec.cross(forward, up));
  forward = rotate(forward, right, state.pitch * DEG);

  camera.position.copy(toWorld(pos));
  camera.up.copy(toWorld(up));
  camera.lookAt(toWorld(vec.add(pos, forward)));
  return { ground };
}

// --- UI ---------------------------------------------------------------------
function setStatus(text) {
  $('status').textContent = text;
  $('status').hidden = !text;
}

function syncUi() {
  $('mode-orbit').classList.toggle('on', state.mode === 'orbit');
  $('mode-olympus').classList.toggle('on', state.mode === 'olympus');
  $('exag').value = state.exaggeration;
  $('exag-val').textContent = `${state.exaggeration}×`;
  $('atmo').value = state.thickness;
  $('atmo-val').textContent = `${state.thickness}×`;
  $('speed').value = state.timeScale;
  $('haze').value = state.haze;
  $('haze-val').textContent = state.haze.toFixed(2);
  $('hero').hidden = !state.hero;
  $('hud').hidden = !state.hud;
  $('hero-toggle').checked = state.hero;
}

$('mode-orbit').onclick = () => {
  state.mode = 'orbit';
  applyMode();
};
$('mode-olympus').onclick = () => {
  state.mode = 'olympus';
  applyMode();
};
$('exag').oninput = (e) => ($('exag-val').textContent = `${e.target.value}×`);
$('exag').onchange = (e) => {
  state.exaggeration = Number(e.target.value);
  setExaggeration(state.exaggeration);
};
$('atmo').oninput = (e) => {
  state.thickness = Number(e.target.value);
  $('atmo-val').textContent = `${state.thickness}×`;
};
$('speed').onchange = (e) => (state.timeScale = Number(e.target.value));
$('sun').oninput = (e) => {
  lighting.sunIntensity.value = Number(e.target.value);
  $('sun-val').textContent = e.target.value;
};
$('glow').oninput = (e) => {
  atmosphere.uniforms.sunIntensity.value = Number(e.target.value);
  $('glow-val').textContent = e.target.value;
};
$('haze').oninput = (e) => {
  state.haze = Number(e.target.value);
  $('haze-val').textContent = state.haze.toFixed(2);
};
$('time').oninput = (e) => {
  state.timeOffsetH = Number(e.target.value);
  $('time-val').textContent = `${state.timeOffsetH >= 0 ? '+' : ''}${state.timeOffsetH}h`;
};
$('reshoot').onclick = () => {
  state.phi = Math.random() * 360;
  state.heading = 75 + Math.random() * 40;
  state.yaw = 0;
  state.pitch = 0;
};
$('hero-toggle').onchange = (e) => {
  state.hero = e.target.checked;
  syncUi();
};
addEventListener('keydown', (e) => {
  if (e.key === 'h') {
    state.hud = !state.hud;
    syncUi();
  }
});

let drag = null;
renderer.domElement.addEventListener('pointerdown', (e) => (drag = { x: e.clientX, y: e.clientY, yaw: state.yaw, pitch: state.pitch }));
addEventListener('pointerup', () => (drag = null));
addEventListener('pointermove', (e) => {
  if (!drag) return;
  state.yaw = drag.yaw - (e.clientX - drag.x) * 0.1;
  state.pitch = Math.max(-60, Math.min(60, drag.pitch - (e.clientY - drag.y) * 0.1));
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// --- Loop -------------------------------------------------------------------
const starMatrix = new THREE.Matrix4();
let frames = 0;
let fpsT = performance.now();
let fps = 0;
let frameMs = 0;

function transferredMB() {
  return performance
    .getEntriesByType('resource')
    .filter((r) => r.name.includes('/data/'))
    .reduce((sum, r) => sum + (r.encodedBodySize || r.transferSize || 0), 0) / 1e6;
}

function gpuTextureMB() {
  const tex = (w, h) => (w * h * 4 * 1.33) / 1e6;
  let mb = tex(8192, 4096) + tex(globalHeight.width, globalHeight.height);
  if (region) mb += tex(4096, 3511) + tex(region.height.width, region.height.height);
  return mb;
}

lighting.graticule.value = params.get('grat') === '1' ? 1 : 0;
window.proto = { atmosphere, lighting, renderer, state, global, applyMode, get region() { return region; } };

await applyMode();
syncUi();
setStatus('');
document.body.classList.add('ready');

renderer.setAnimationLoop(() => {
  const t0 = performance.now();
  const date = simDate();
  const st = marsState(date);
  const t = (performance.now() - startWall) / 1000;
  const { ground } = placeCamera(st.sun, t);

  const sunW = toWorld(st.sun);
  sunLight.position.copy(sunW).multiplyScalar(1e4);
  sunDisc.position.copy(sunW).multiplyScalar(1e5);
  atmosphere.uniforms.sunDir.value.copy(sunW);
  lighting.sunDir.value.copy(sunW);
  atmosphere.uniforms.thickness.value = state.thickness;
  atmosphere.uniforms.density.value = state.haze;
  lighting.opticalDepth.value = state.haze * 0.7;
  atmosphere.update(camera);

  const f = st.frame;
  starMatrix.set(f.x[0], f.x[1], f.x[2], 0, f.z[0], f.z[1], f.z[2], 0, -f.y[0], -f.y[1], -f.y[2], 0, 0, 0, 0, 1);
  stars.matrix.copy(starMatrix);
  stars.matrixWorldNeedsUpdate = true;

  pipeline.render();

  frames++;
  frameMs = frameMs * 0.95 + (performance.now() - t0) * 0.05;
  if (t0 - fpsT > 500) {
    fps = (frames * 1000) / (t0 - fpsT);
    frames = 0;
    fpsT = t0;
    const lat = Math.asin(ground[2]) / DEG;
    const lon = ((Math.atan2(ground[1], ground[0]) / DEG) % 360 + 360) % 360;
    const ns = lat >= 0 ? 'N' : 'S';
    $('telemetry').textContent = `MARS · ${Math.abs(lat).toFixed(1)}°${ns} ${lon.toFixed(1)}°E · LOCAL SOLAR ${localSolarTime(lon, st.subSolarLon)} · ${st.distanceAu.toFixed(2)} AU`;
    $('hud-body').textContent = [
      `backend      ${backend}`,
      `fps          ${fps.toFixed(0)}  (cpu ${frameMs.toFixed(1)} ms)`,
      `downloaded   ${transferredMB().toFixed(1)} MB`,
      `gpu textures ~${gpuTextureMB().toFixed(0)} MB (uncompressed)`,
      `triangles    ${(renderer.info.render.triangles / 1e6).toFixed(2)} M`,
      `sim time     ${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
      `subsolar     ${st.subSolarLat.toFixed(1)}°, ${st.subSolarLon.toFixed(1)}°E`,
    ].join('\n');
  }
});
