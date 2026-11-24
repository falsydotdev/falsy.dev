import * as THREE from 'three/webgpu';
import { smoothstep, uniform } from 'three/tsl';

// Body frame (x: lon 0, y: lon 90E, z: north) -> three.js world (y up).
export const toWorld = (b) => new THREE.Vector3(b[0], b[2], -b[1]);

/**
 * Share of the night fill for a surface whose Sun is at sine `su`: none in daylight, so day shadows keep
 * their contrast. Flat ground just sunward of the terminator is dimmer, but twilight air glow covers it.
 */
export const nightSide = (su) => smoothstep(-0.05, 0.05, su).oneMinus();

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
    nightFill: uniform(new THREE.Color(...(l.night?.tint ?? [0, 0, 0])).multiplyScalar(l.night?.level ?? 0)),
    shadows: uniform(1),
  };
}
