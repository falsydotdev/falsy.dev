import * as THREE from 'three/webgpu';
import { Fn, Loop, If, uniform, vec3, vec4, float, positionWorld, cameraPosition, normalize, exp, dot, sqrt, max, min, length, pow } from 'three/tsl';

// Single-scattering atmosphere raymarched in a shell around the planet (units: km).
// Mars is dust-dominated: Mie scattering with a per-channel phase asymmetry, so blue
// light is scattered more tightly around the Sun. That gives the blue Martian sunset.
const VIEW_STEPS = 24;
const LIGHT_STEPS = 6;

export function createAtmosphere({ planetRadius }) {
  const u = {
    sunDir: uniform(new THREE.Vector3(1, 0, 0)),
    sunIntensity: uniform(16),
    thickness: uniform(1),
    planetRadius: uniform(planetRadius),
    scaleHeight: uniform(11),
    topHeights: uniform(10),
    rayleigh: uniform(new THREE.Vector3(1.45e-4, 3.4e-4, 8.3e-4)),
    mieScatter: uniform(new THREE.Vector3(0.042, 0.03, 0.019)),
    mieExtinction: uniform(new THREE.Vector3(0.046, 0.046, 0.046)),
    mieG: uniform(new THREE.Vector3(0.62, 0.7, 0.82)),
    density: uniform(0.45),
  };

  const shade = Fn(() => {
    const R = u.planetRadius;
    const H = u.scaleHeight.mul(u.thickness);
    const Ra = R.add(H.mul(u.topHeights));
    const ro = cameraPosition;
    const rd = normalize(positionWorld.sub(cameraPosition));

    const b = dot(ro, rd);
    const c = dot(ro, ro).sub(Ra.mul(Ra));
    const sq = sqrt(max(b.mul(b).sub(c), 0));
    const tStart = max(b.negate().sub(sq), 0);
    const tEnd = b.negate().add(sq).toVar();
    const discP = b.mul(b).sub(dot(ro, ro).sub(R.mul(R)));
    If(discP.greaterThan(0), () => {
      const tp = b.negate().sub(sqrt(discP));
      If(tp.greaterThan(0), () => {
        tEnd.assign(min(tEnd, tp));
      });
    });

    const seg = max(tEnd.sub(tStart), 0).div(VIEW_STEPS);
    const odR = float(0).toVar();
    const odM = float(0).toVar();
    const sumR = vec3(0).toVar();
    const sumM = vec3(0).toVar();
    const sun = u.sunDir;

    Loop({ start: 0, end: VIEW_STEPS, name: 'i' }, ({ i }) => {
      const t = tStart.add(seg.mul(float(i).add(0.5)));
      const p = ro.add(rd.mul(t));
      const h = length(p).sub(R);
      const d = exp(h.negate().div(H)).mul(seg).mul(u.density);
      odR.addAssign(d);
      odM.addAssign(d);

      const bl = dot(p, sun);
      const shadowDisc = bl.mul(bl).sub(dot(p, p).sub(R.mul(R)));
      const lit = shadowDisc.lessThan(0).or(bl.negate().sub(sqrt(max(shadowDisc, 0))).lessThan(0));
      If(lit, () => {
        const tl = bl.negate().add(sqrt(max(bl.mul(bl).sub(dot(p, p).sub(Ra.mul(Ra))), 0)));
        const segL = tl.div(LIGHT_STEPS);
        const odL = float(0).toVar();
        Loop({ start: 0, end: LIGHT_STEPS, name: 'j' }, ({ j }) => {
          const q = p.add(sun.mul(segL.mul(float(j).add(0.5))));
          odL.addAssign(exp(length(q).sub(R).negate().div(H)).mul(segL).mul(u.density));
        });
        const tau = u.rayleigh.mul(odR.add(odL)).add(u.mieExtinction.mul(odM.add(odL)));
        const att = exp(tau.negate());
        sumR.addAssign(att.mul(d));
        sumM.addAssign(att.mul(d));
      });
    });

    const mu = dot(rd, sun);
    const phaseR = mu.mul(mu).add(1).mul(3 / (16 * Math.PI));
    const g = u.mieG;
    const g2 = g.mul(g);
    const phaseM = g2.oneMinus().div(pow(g2.add(1).sub(g.mul(mu).mul(2)), vec3(1.5)).mul(4 * Math.PI));
    const color = sumR.mul(u.rayleigh).mul(phaseR).add(sumM.mul(u.mieScatter).mul(phaseM)).mul(u.sunIntensity);
    const trans = exp(u.rayleigh.mul(odR).add(u.mieExtinction.mul(odM)).negate());
    const alpha = trans.x.add(trans.y).add(trans.z).div(3).oneMinus();
    return vec4(color, alpha);
  });

  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  mat.colorNode = shade();
  mat.blending = THREE.CustomBlending;
  mat.blendSrc = THREE.OneFactor;
  mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  mat.blendSrcAlpha = THREE.OneFactor;
  mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 256, 128), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;

  function update(camera) {
    const ra = planetRadius + u.scaleHeight.value * u.thickness.value * u.topHeights.value;
    mesh.scale.setScalar(ra);
    const inside = camera.position.length() < ra;
    mat.side = inside ? THREE.BackSide : THREE.FrontSide;
    mat.depthTest = !inside;
  }

  return { mesh, uniforms: u, update };
}
