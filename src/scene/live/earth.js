import * as THREE from 'three/webgpu';
import { float, max, normalWorld, positionWorld, cameraPosition, pow, smoothstep, texture, uniform, vec3 } from 'three/tsl';
import { toWorld } from './terrain.js';
import { bodyFrame, toBody } from '../ephemeris';

const EARTH_RADIUS_KM = 6371;
// Drawn this far from the camera at its true angular size: in front of the Sun's disc, so it can
// eclipse it, and behind any terrain.
const DISTANCE_KM = 9e4;
const EARTH = /** @type {import('../bodies.ts').Body} */ ({ ae: 'Earth' });

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
    .catch(() => {});

  const basis = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  return {
    object: mesh,
    /**
     * @param {THREE.Camera} camera
     * @param {import('../ephemeris').BodyFrame} moonFrame the Moon's body frame, which the scene's world axes follow
     * @param {import('../ephemeris').Vec3} earthKm Moon-centre-to-Earth vector, J2000, km
     * @param {import('../ephemeris').Vec3} camKm Moon-centre-to-camera vector, J2000, km
     * @param {THREE.Vector3} sunW unit vector toward the Sun, world axes
     * @param {Date} date
     */
    update(camera, moonFrame, earthKm, camKm, sunW, date) {
      const world = (v) => toWorld(toBody(moonFrame, v));
      const rel = world([earthKm[0] - camKm[0], earthKm[1] - camKm[1], earthKm[2] - camKm[2]]);
      const k = DISTANCE_KM / rel.length();
      pos.copy(camera.position).addScaledVector(rel, k);
      // The sphere's texture has longitude 0 on local +X, 90°E on −Z, and north on +Y.
      const f = bodyFrame(EARTH, date);
      basis.makeBasis(world(f.x), world(f.z), world(f.y).negate());
      mesh.matrix.copy(basis).scale(new THREE.Vector3(EARTH_RADIUS_KM * k, EARTH_RADIUS_KM * k, EARTH_RADIUS_KM * k)).setPosition(pos);
      mesh.matrixWorldNeedsUpdate = true;
      sunDir.value.copy(sunW);
    },
    dispose() {
      disposed = true;
      mesh.geometry.dispose();
      material.dispose();
      map?.dispose();
    },
  };
}
