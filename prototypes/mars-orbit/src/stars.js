import * as THREE from 'three/webgpu';

// Procedural star field in J2000 coordinates, concentrated toward a galactic plane band.
// Placeholder for a real catalogue (e.g. HYG or Gaia bright stars).
export function createStars(count = 9000, radius = 2e5) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const galNorth = new THREE.Vector3(-0.867, -0.198, 0.456).normalize();
  const v = new THREE.Vector3();
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < count; i++) {
    do {
      v.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1);
    } while (v.lengthSq() > 1 || v.lengthSq() < 1e-4);
    v.normalize();
    if (i % 3 === 0) v.addScaledVector(galNorth, -v.dot(galNorth) * 0.85).normalize();
    pos.set([v.x * radius, v.y * radius, v.z * radius], i * 3);
    const mag = Math.pow(rnd(), 6) * 3 + 0.04;
    const t = rnd();
    const tint = t < 0.15 ? [0.75, 0.82, 1] : t > 0.85 ? [1, 0.82, 0.62] : [1, 0.97, 0.92];
    col.set(tint.map((c) => c * mag), i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsNodeMaterial({ vertexColors: true, depthWrite: false, sizeAttenuation: false });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.matrixAutoUpdate = false;
  return points;
}
