import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';

export const RADIUS_KM = 3396.19;

// Mars body frame (x: lon 0, y: lon 90E, z: north) -> three.js world (y up).
export const toWorld = (b) => new THREE.Vector3(b[0], b[2], -b[1]);

// Lighting inputs shared by the planet surface and the scene.
export const lighting = {
  sunDir: uniform(new THREE.Vector3(1, 0, 0)),
  sunColor: uniform(new THREE.Color(1, 0.95, 0.88)),
  sunIntensity: uniform(3.4),
  ambient: uniform(0.015),
  shadows: uniform(1),
  opticalDepth: uniform(0.35),
};
