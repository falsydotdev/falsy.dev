import type { Vec3 } from './ephemeris.ts';
import { orbitCameraPose, project } from './camera.ts';

/** A screen region as fractions of the viewport, measured from the top left. */
export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface FramingInput {
  radiusKm: number;
  altKm: number;
  fovDeg: number;
  aspect: number;
  text: Box;
  headerBottom: number;
}

export interface Framing {
  tiltDeg: number;
  rollDeg: number;
}

// The bright band above the limb is about three scale heights of dust (11 km each), so the
// exclusion uses that shell rather than the bare surface.
export const GLOW_KM = 35;
const MARGIN = 0.03;
// Where the limb should meet the right edge, as a fraction of the height from the top.
const RIGHT_TARGET = 0.3;
// Roll is a stylistic tilt; each 10° costs as much as missing the target by 0.1.
const ROLL_COST = 0.01;
const TILTS = range(-10, 25, 0.5);
const ROLLS = range(0, 20, 0.5);
export const FALLBACK_FRAMING: Framing = { tiltDeg: 12, rollDeg: 0 };

function range(from: number, to: number, step: number) {
  return Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => from + i * step);
}

/**
 * The limb of a sphere of radius `radiusKm + glowKm`, as seen from the orbit camera, in
 * viewport fractions sorted left to right. Only the part in front of the camera is kept.
 */
export function limbOnScreen(f: Omit<FramingInput, 'text' | 'headerBottom'>, framing: Framing, glowKm = GLOW_KM, samples = 240) {
  const D = f.radiusKm + f.altKm;
  const rho = f.radiusKm + glowKm;
  const pose = orbitCameraPose([0, 0, D], [1, 0, 0], f.radiusKm, framing.tiltDeg, framing.rollDeg);
  const cz = (rho * rho) / D;
  const s = rho * Math.sqrt(1 - (rho * rho) / (D * D));
  const fov = (f.fovDeg * Math.PI) / 180;
  const points: [number, number][] = [];
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * 2 * Math.PI;
    const p: Vec3 = [s * Math.cos(a), s * Math.sin(a), cz];
    const ndc = project(p, pose, fov, f.aspect);
    if (!ndc || Math.abs(ndc[0]) > 1.6 || Math.abs(ndc[1]) > 1.6) continue;
    points.push([(ndc[0] + 1) / 2, (1 - ndc[1]) / 2]);
  }
  return points.sort((a, b) => a[0] - b[0]);
}

/** Height of the limb (fraction from the top) where it meets screen column `x`. */
export function limbHeightAt(limb: [number, number][], x: number) {
  if (limb.length === 0) return Infinity;
  for (let i = 1; i < limb.length; i++) {
    const [x0, y0] = limb[i - 1];
    const [x1, y1] = limb[i];
    if (x0 <= x && x <= x1) return x1 === x0 ? y0 : y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return limb[limb.length - 1][1];
}

/** True when the limb's glow stays below the text block and the header everywhere it's on screen. */
export function keepsClear(limb: [number, number][], text: Box, headerBottom: number) {
  return limb.every(([x, y]) => {
    if (x < 0 || x > 1) return true;
    if (y < headerBottom + MARGIN) return false;
    return x < text.left - MARGIN || x > text.right + MARGIN || y > text.bottom + MARGIN;
  });
}

/**
 * Picks the camera pitch and roll for this viewport: the limb passes below the text
 * column, then rises toward the upper right so the planet fills the open side of the page.
 */
export function solveFraming(f: FramingInput): Framing {
  let best: Framing | null = null;
  let bestScore = Infinity;
  for (const rollDeg of ROLLS) {
    for (const tiltDeg of TILTS) {
      const framing = { tiltDeg, rollDeg };
      const limb = limbOnScreen(f, framing);
      if (!keepsClear(limb, f.text, f.headerBottom)) continue;
      const score = (limbHeightAt(limb, 1) - RIGHT_TARGET) ** 2 + ROLL_COST * (rollDeg / 10) ** 2;
      if (score < bestScore) {
        bestScore = score;
        best = framing;
      }
    }
  }
  return best ?? FALLBACK_FRAMING;
}
