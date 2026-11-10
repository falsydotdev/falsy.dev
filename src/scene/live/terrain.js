import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';

// Body frame (x: lon 0, y: lon 90E, z: north) -> three.js world (y up).
export const toWorld = (b) => new THREE.Vector3(b[0], b[2], -b[1]);

/**
 * Lighting inputs for one scene's planet surface, set from its body. Each scene has its own, since
 * two run at once during a body switch.
 * @param {import('../bodies.ts').Body} body
 */
export function createLighting(body) {
  const l = body.light;
  return {
    sunDir: uniform(new THREE.Vector3(1, 0, 0)),
    sunColor: uniform(new THREE.Color(...l.sunColor)),
    sunIntensity: uniform(l.sunIntensity),
    sunDiameter: uniform(body.sunDiameterRad),
    ambient: uniform(l.ambient),
    skyTint: uniform(new THREE.Color(...l.skyTint)),
    extinction: uniform(new THREE.Vector3(...l.extinction)),
    shadows: uniform(1),
    // The surface haze is thinner than the full limb path the scattering shell models.
    opticalDepth: uniform((body.atmosphere?.density ?? 0) * 0.7),
  };
}
