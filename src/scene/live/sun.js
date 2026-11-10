import * as THREE from 'three/webgpu';
import { exp, float, smoothstep, uv, vec3 } from 'three/tsl';

// Far enough that the disc sits behind any terrain, well inside the camera's far plane.
const DISTANCE_KM = 1e5;
// A camera's glare around the Sun. Same angular size for every body; brightness follows the sunlight.
const HALO_RADIUS_RAD = 0.12;
const HALO_STRENGTH = 1;

/**
 * The Sun's disc at its true apparent size, with a soft glare around it, kept centred on the
 * camera so its direction matches the light on the terrain.
 * @param {import('../bodies.ts').Body} body
 */
export function createSun(body) {
  const disc = new THREE.Mesh(
    new THREE.SphereGeometry((body.sunDiameterRad / 2) * DISTANCE_KM, 32, 16),
    new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(60, 55, 48) }),
  );

  const halo = new THREE.Mesh(new THREE.PlaneGeometry(2 * HALO_RADIUS_RAD * DISTANCE_KM, 2 * HALO_RADIUS_RAD * DISTANCE_KM), new THREE.MeshBasicNodeMaterial());
  const d = uv().sub(0.5).length().mul(2);
  // A tight bright core and a wide faint skirt, like glare in a lens.
  const glow = exp(d.mul(-28)).mul(6).add(exp(d.mul(-6)).mul(1)).mul(float(1).sub(smoothstep(0.15, 1, d)));
  halo.material.colorNode = vec3(1, 0.92, 0.78).mul(glow.mul(HALO_STRENGTH * (body.light.sunIntensity / 3.4)));
  halo.material.transparent = true;
  halo.material.depthWrite = false;
  halo.material.blending = THREE.AdditiveBlending;

  const group = new THREE.Group();
  group.add(halo, disc);
  return {
    object: group,
    /** @param {THREE.Camera} camera @param {THREE.Vector3} sunDir unit vector toward the Sun */
    update(camera, sunDir) {
      disc.position.copy(camera.position).addScaledVector(sunDir, DISTANCE_KM);
      halo.position.copy(disc.position);
      halo.quaternion.copy(camera.quaternion);
    },
    dispose() {
      disc.geometry.dispose();
      disc.material.dispose();
      halo.geometry.dispose();
      halo.material.dispose();
    },
  };
}
