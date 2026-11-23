import * as THREE from 'three/webgpu';
import { smoothstep, uniform } from 'three/tsl';

// Body frame (x: lon 0, y: lon 90E, z: north) -> three.js world (y up).
export const toWorld = (b) => new THREE.Vector3(b[0], b[2], -b[1]);

/**
 * Lighting inputs for one scene's planet surface, set from its body. Each scene has its own, since
 * two run at once during a body switch.
 * @param {import('../bodies.ts').Body} body
 */
/**
 * How much of the night fill reaches a surface whose Sun is at sine `su`: none in daylight, so day
 * shadows keep their contrast, all of it past the terminator, where sunlight is already that dim.
 */
export const nightSide = (su) => smoothstep(-0.05, 0.05, su).oneMinus();

export function createLighting(body) {
  const l = body.light;
  return {
    sunDir: uniform(new THREE.Vector3(1, 0, 0)),
    sunColor: uniform(new THREE.Color(...l.sunColor)),
    sunIntensity: uniform(l.sunIntensity),
    sunDiameter: uniform(body.sunDiameterRad),
    ambient: uniform(l.ambient),
    skyTint: uniform(new THREE.Color(...l.skyTint)),
    nightFill: uniform(new THREE.Color(...(l.night?.tint ?? [0, 0, 0])).multiplyScalar(l.night?.level ?? 0)),
    shadows: uniform(1),
  };
}
