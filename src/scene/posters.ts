// The poster stills as Stage.astro inlines them into every page: readout, title, and sources.
import { BODIES } from './bodies.ts';

type Sources = { src: string; width: number }[];

export interface Poster {
  id: string;
  body: string;
  lat: number;
  lon: number;
  lst: string;
  altKm: number;
  relief: number;
  at: string;
  focus: string;
  horizon: number;
  label: string;
  sources: Sources;
  portrait?: Pick<Poster, 'lat' | 'lon' | 'lst' | 'altKm' | 'at'> & { sources: Sources };
}

const pad = (n: number) => String(n).padStart(2, '0');
const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function telemetry(p: Pick<Poster, 'lat' | 'lon' | 'lst' | 'altKm' | 'relief' | 'at'>) {
  const at = new Date(p.at);
  const lat = `${Math.abs(p.lat).toFixed(1)}°${p.lat >= 0 ? 'N' : 'S'}`;
  const lon = `${(((p.lon % 360) + 360) % 360).toFixed(1)}°E`;
  const still = `${pad(at.getUTCDate())} ${months[at.getUTCMonth()]} ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())} UTC`;
  // The body name is the switch button, which the stage keeps in front of these.
  const parts = [
    [lat, ''],
    [lon, ''],
    [`LST ${p.lst}`, ''],
    [`ALT ${p.altKm} km`, 'wide'],
    [`relief×${p.relief}`, 'wide'],
    [`still ${still}`, 'wide'],
  ];
  return parts.map(([text, cls]) => `<span${cls ? ` class="${cls}"` : ''}>${text}</span>`).join('');
}

const srcset = (sources: Sources) => sources.map((s) => `${s.src} ${s.width}w`).join(', ');

/** The stills of the bodies a visitor can reach (`listedBodyIds`), so an unlisted body's never ships. */
export function posterChoices(posters: Poster[], bodies: readonly string[]) {
  return posters
    .filter((p) => bodies.includes(p.body.toLowerCase()))
    .map((p) => ({
      id: p.id,
      body: p.body.toLowerCase(),
      focus: p.focus,
      horizon: p.horizon,
      src: p.sources[1]?.src ?? p.sources[0].src,
      srcset: srcset(p.sources),
      portrait: p.portrait ? { src: p.portrait.sources[0].src, srcset: srcset(p.portrait.sources), telemetry: telemetry({ ...p, ...p.portrait }) } : null,
      telemetry: telemetry(p),
      title: `${p.label}. A still frame rendered from ${BODIES[p.body.toLowerCase()].dataCredit}, lit by the real Sun position at ${p.at.slice(0, 10)} ${p.at.slice(11, 16)} UTC. Relief is exaggerated ${p.relief}×.`,
    }));
}
