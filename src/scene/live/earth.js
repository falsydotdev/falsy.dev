import * as THREE from 'three/webgpu';
import { float, max, normalWorld, positionWorld, cameraPosition, pow, smoothstep, texture, uniform, vec3 } from 'three/tsl';
import { toWorld } from './terrain.js';
import { bodyFrame, earthFromMoon, toBody } from '../ephemeris';

const EARTH_RADIUS_KM = 6371;
// Drawn this far from the camera at its true angular size: in front of the Sun's disc, so it can
// eclipse it, and behind any terrain.
const DISTANCE_KM = 9e4;
const EARTH = /** @type {import('../bodies.ts').Body} */ ({ ae: 'Earth' });
// Earth's place and spin change by well under a pixel a second, so they're recomputed at most this often.
const REFRESH_MS = 1000;

/**
 * Earth as seen from the Moon: NASA's Blue Marble on a sphere turned to its real rotation, lit
 * by the Sun. Hidden until the texture arrives, and for good if it fails to load.
 * @param {{ url: string, lighting: { sunColor: any, sunIntensity: any } }} opts
 */
export function createEarth({ url, lighting }) {
  const sunDir = uniform(new THREE.Vector3(1, 0, 0));
  const material = new THREE.MeshBasicNodeMaterial();
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), material);
  mesh.visible = false;
  mesh.matrixAutoUpdate = false;

  let map = null;
  let disposed = false;
  new THREE.TextureLoader()
    .loadAsync(url)
    .then((tex) => {
      if (disposed) return tex.dispose();
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      map = tex;
      const ndl = normalWorld.dot(sunDir);
      // A soft terminator, as the atmosphere bends light a little past it.
      const day = smoothstep(-0.04, 0.12, ndl).mul(max(ndl, 0.02));
      const lit = texture(tex).rgb.mul(lighting.sunColor).mul(lighting.sunIntensity).mul(day);
      const view = cameraPosition.sub(positionWorld).normalize();
      const rim = pow(float(1).sub(max(normalWorld.dot(view), 0)), 4).mul(smoothstep(-0.2, 0.3, ndl));
      material.colorNode = lit.add(vec3(0.25, 0.45, 1).mul(rim).mul(lighting.sunIntensity).mul(0.35));
      material.needsUpdate = true;
      mesh.visible = true;
    })
    .catch((err) => console.warn('Earth texture failed; Earth stays hidden.', err));

  const basis = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const rel = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const occluder = { dir: new THREE.Vector3(), radiusRad: 0 };
  let earthKm = null;
  let earthAxes = null;
  let refreshedAt = -Infinity;
  return {
    object: mesh,
    /**
     * Places Earth for this frame, and returns its direction and angular radius for anything it can cover.
     * @param {THREE.Camera} camera
     * @param {import('../ephemeris').BodyFrame} moonFrame the Moon's body frame, which the scene's world axes follow
     * @param {import('../ephemeris').Vec3} camKm Moon-centre-to-camera vector, J2000, km
     * @param {THREE.Vector3} sunW unit vector toward the Sun, world axes
     * @param {Date} date
     */
    update(camera, moonFrame, camKm, sunW, date) {
      if (Math.abs(date.getTime() - refreshedAt) >= REFRESH_MS) {
        refreshedAt = date.getTime();
        earthKm = earthFromMoon(date);
        earthAxes = bodyFrame(EARTH, date);
      }
      const world = (v) => toWorld(toBody(moonFrame, v));
      rel.copy(world([earthKm[0] - camKm[0], earthKm[1] - camKm[1], earthKm[2] - camKm[2]]));
      const distance = rel.length();
      const k = DISTANCE_KM / distance;
      pos.copy(camera.position).addScaledVector(rel, k);
      // The sphere's texture has longitude 0 on local +X, 90°E on −Z, and north on +Y.
      basis.makeBasis(world(earthAxes.x), world(earthAxes.z), world(earthAxes.y).negate());
      mesh.matrix.copy(basis).scale(scale.setScalar(EARTH_RADIUS_KM * k)).setPosition(pos);
      mesh.matrixWorldNeedsUpdate = true;
      sunDir.value.copy(sunW);
      occluder.dir.copy(rel).divideScalar(distance);
      occluder.radiusRad = Math.asin(EARTH_RADIUS_KM / distance);
      return mesh.visible ? occluder : null;
    },
    dispose() {
      disposed = true;
      mesh.geometry.dispose();
      material.dispose();
      map?.dispose();
    },
  };
}
