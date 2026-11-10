import * as THREE from 'three/webgpu';
import { cameraPosition, exp, float, max, smoothstep, uniform, uv, vec3 } from 'three/tsl';

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
  const sunRadius = body.sunDiameterRad / 2;
  const disc = new THREE.Mesh(
    new THREE.SphereGeometry(sunRadius * DISTANCE_KM, 32, 16),
    new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(60, 55, 48) }),
  );

  const halo = new THREE.Mesh(new THREE.PlaneGeometry(2 * HALO_RADIUS_RAD * DISTANCE_KM, 2 * HALO_RADIUS_RAD * DISTANCE_KM), new THREE.MeshBasicNodeMaterial());
  const d = uv().sub(0.5).length().mul(2);
  // A tight bright core and a wide faint skirt, like glare in a lens.
  const glow = exp(d.mul(-28)).mul(6).add(exp(d.mul(-6)).mul(1)).mul(float(1).sub(smoothstep(0.15, 1, d)));
  const sunDir = uniform(new THREE.Vector3(1, 0, 0));
  // How much of the disc another body (Earth) leaves uncovered, set each frame.
  const uncoveredBy = uniform(1);
  const base = vec3(1, 0.92, 0.78).mul(glow).mul(uncoveredBy).mul(HALO_STRENGTH * (body.light.sunIntensity / 3.4));
  halo.material.colorNode = base;
  halo.material.transparent = true;
  halo.material.depthWrite = false;
  halo.material.blending = THREE.AdditiveBlending;

  const uncovered = (dir, radiusRad) => {
    const gap = Math.acos(Math.min(1, Math.max(-1, dir.dot(sunDir.value)))) - radiusRad;
    const t = Math.min(1, Math.max(0, (gap + sunRadius) / (2 * sunRadius)));
    return t * t * (3 - 2 * t);
  };

  const group = new THREE.Group();
  group.add(halo, disc);
  return {
    object: group,
    /**
     * The halo is a flat quad far behind the limb, so depth can't hide it while terrain covers the
     * disc. This tests the line of sight to the Sun against the terrain where it passes lowest.
     * @param {(dir: any) => any} heightAt TSL: world-space unit direction to terrain height, km
     */
    useTerrain(heightAt) {
      const c = cameraPosition;
      const t = max(c.dot(sunDir).negate(), 0);
      const lowest = c.add(sunDir.mul(t));
      const r = lowest.length();
      const clearance = r.sub(float(body.radiusKm).add(heightAt(lowest.div(r))));
      halo.material.colorNode = base.mul(smoothstep(-sunRadius, sunRadius, clearance.div(max(t, 1))));
      halo.material.needsUpdate = true;
    },
    /**
     * @param {THREE.Camera} camera, positioned relative to the body's centre
     * @param {THREE.Vector3} dir unit vector toward the Sun
     * @param {{ dir: THREE.Vector3, radiusRad: number } | null} [occluder] another body that can cover the Sun
     */
    update(camera, dir, occluder = null) {
      sunDir.value.copy(dir);
      disc.position.copy(camera.position).addScaledVector(dir, DISTANCE_KM);
      halo.position.copy(disc.position);
      halo.quaternion.copy(camera.quaternion);
      uncoveredBy.value = occluder ? uncovered(occluder.dir, occluder.radiusRad) : 1;
    },
    dispose() {
      disc.geometry.dispose();
      disc.material.dispose();
      halo.geometry.dispose();
      halo.material.dispose();
    },
  };
}
