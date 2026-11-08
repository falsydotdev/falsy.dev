import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';

// Body frame (x: lon 0, y: lon 90E, z: north) -> three.js world (y up).
export const toWorld = (b) => new THREE.Vector3(b[0], b[2], -b[1]);

// Lighting inputs shared by the planet surface and the scene. `applyBodyLight` sets them per body.
export const lighting = {
  sunDir: uniform(new THREE.Vector3(1, 0, 0)),
  sunColor: uniform(new THREE.Color(1, 1, 1)),
  sunIntensity: uniform(3.4),
  sunDiameter: uniform(0.0061),
  ambient: uniform(0.015),
  skyTint: uniform(new THREE.Color(1, 1, 1)),
  extinction: uniform(new THREE.Vector3(1, 1, 1)),
  shadows: uniform(1),
  opticalDepth: uniform(0),
};

/** @param {import('../bodies.ts').Body} body */
export function applyBodyLight(body) {
  const l = body.light;
  lighting.sunColor.value.setRGB(...l.sunColor);
  lighting.sunIntensity.value = l.sunIntensity;
  lighting.sunDiameter.value = body.sunDiameterRad;
  lighting.ambient.value = l.ambient;
  lighting.skyTint.value.setRGB(...l.skyTint);
  lighting.extinction.value.set(...l.extinction);
  // The surface haze is thinner than the full limb path the scattering shell models.
  lighting.opticalDepth.value = (body.atmosphere?.density ?? 0) * 0.7;
}
