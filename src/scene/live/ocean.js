import { If, cameraPosition, clamp, dot, exp, float, floor, fract, max, mix, normalize, positionWorld, smoothstep, uniform, vec2, vec3 } from 'three/tsl';
import { WATER_F0, slopeVariance } from '../ocean.ts';

const GLINT = { off: 0, ggx: 1, 'cox-munk': 2 };

const schlick = (cos) => float(1).sub(cos).pow(5).mul(1 - WATER_F0).add(WATER_F0);

/**
 * Sea shading for a body with an ocean (see `Ocean` in bodies.ts): water-leaving colour from the
 * depth, the sky's reflection through Fresnel, and the Sun's glint. Land shading passes through.
 * @param {import('../bodies.ts').Ocean} ocean
 * @param {{ lighting: ReturnType<typeof import('./terrain.js').createLighting>, air: Awaited<ReturnType<typeof import('./atmosphere-tables.js').createAtmosphereTables>> | null, radiusKm: number }} deps
 */
export function createOcean(ocean, { lighting, air, radiusKm }) {
  const glint = uniform(GLINT['cox-munk']);
  const sigma2 = slopeVariance(ocean.windMs);
  // Schlick's Smith masking with GGX's k = α/2, taking α² as the slope variance for both models.
  const k = Math.sqrt(sigma2) / 2;
  const masking = (cos) => cos.div(cos.mul(1 - k).add(k));

  // Depth falls from metres to kilometres within one coarse texel at a shelf edge, so the tint is
  // filtered after it's computed from each texel; filtering the depth first drew stair steps.
  const shallowness = ({ map, size, uv }) => {
    const texels = vec2(...size);
    const p = uv.mul(texels).sub(0.5);
    const i = floor(p);
    const f = fract(p);
    const at = (dx, dy) => exp(map.sample(i.add(vec2(dx + 0.5, dy + 0.5)).div(texels)).level(0).r.min(0).mul(1000 / ocean.shallowDepthM));
    return mix(mix(at(0, 0), at(1, 0), f.x), mix(at(0, 1), at(1, 1), f.x), f.y);
  };

  /**
   * `land` (0–1) is the water mask, `su` the Sun's cosine from sphere normal `n`, and `seaFloor` the
   * map of sea-floor heights in km (negative under the sea) with its size and the point's uv on it.
   */
  const shade = ({ land, color, n, su, shadow, seaFloor }) => {
    const s = lighting.sunDir;
    const R = float(radiusKm);
    // TSL declares a shared node where it is first built, so one first built inside an Else branch
    // reads as zero after it. Shared inputs become variables up front; branches build their own nodes.
    const lit = shadow.toVar();
    const view = () => normalize(cameraPosition.sub(positionWorld));
    const toSun = () => exp(air.opticalDepth(R, max(su, 0)).negate());
    const sunlight = (through) => {
      const sun = lighting.sunColor.mul(lighting.sunIntensity).mul(lit);
      return air ? sun.mul(through).mul(clamp(su.div(lighting.sunDiameter).add(0.5), 0, 1)) : sun;
    };
    const glare = (distribution) => {
      const V = view();
      const H = normalize(s.add(V));
      const nv = max(dot(n, V), 1e-3);
      const nl = max(dot(n, s), 0);
      const F = schlick(max(dot(V, H), 0));
      return sunlight(air && toSun()).mul(F.mul(distribution(max(dot(n, H), 1e-4).pow(2))).mul(masking(nv)).mul(masking(nl)).div(nv.mul(4)));
    };
    // Cox and Munk's Gaussian slopes, exp(−tan²θh / σ²) / (π σ² cos⁴θh), from c2 = cos²θh.
    const coxMunk = (c2) => exp(c2.sub(1).div(c2.mul(sigma2))).div(c2.mul(c2).mul(Math.PI * sigma2));
    const ggx = (c2) => {
      const d = c2.mul(sigma2 - 1).add(1);
      return float(sigma2 / Math.PI).div(d.mul(d));
    };

    const out = color.toVar();
    If(land.lessThan(0.999), () => {
      const spec = vec3(0).toVar();
      If(glint.greaterThan(1.5), () => {
        spec.assign(glare(coxMunk));
      }).ElseIf(glint.greaterThan(0.5), () => {
        spec.assign(glare(ggx));
      });

      const nv = max(dot(n, view()), 1e-3);
      const daylight = smoothstep(-0.2, 0.25, su);
      const through = air && toSun();
      let sky = vec3(0);
      if (air) {
        // Air glows by what it scatters, so more air along the reflected ray reads as brighter sky:
        // blue overhead, near white toward the horizon.
        const glow = float(1).sub(exp(air.opticalDepth(R, nv).negate()));
        sky = glow.mul(lighting.sunColor).mul(lighting.sunIntensity).mul(ocean.skyLight).mul(through).mul(daylight);
      }
      const fresnel = schlick(nv);
      const shallow = shallowness(seaFloor);
      const water = mix(vec3(...ocean.deep), vec3(...ocean.shallow), shallow);
      const ambient = lighting.skyTint.mul(lighting.ambient).mul(daylight).add(lighting.nightFill.mul(daylight.oneMinus()));
      const leaving = water.mul(sunlight(through).mul(max(dot(n, s), 0)).add(ambient)).mul(float(1).sub(fresnel));
      out.assign(mix(leaving.add(sky.mul(fresnel)).add(spec), color, land));
    });
    return out;
  };

  /** Picks the glint model, or 'off' to drop the glint. */
  const setGlint = (model) => {
    glint.value = GLINT[model];
  };

  return { shade, setGlint };
}
