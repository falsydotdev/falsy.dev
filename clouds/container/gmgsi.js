import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import h5wasm from 'h5wasm/node';

// Decodes one GMGSI longwave NetCDF-4 file into byte counts (0 = no data), the latitude of each
// Mercator row, and the longitude of each column. Counts are 8-bit scaled brightness: cold is high.
// Any nonzero quality flag is no data: flag 20 marks a block of saturated 255s beyond coverage.
export async function readGmgsi(bytes) {
  await h5wasm.ready;
  const dir = mkdtempSync(join(tmpdir(), 'gmgsi-'));
  const path = join(dir, 'in.nc');
  writeFileSync(path, bytes);
  const file = new h5wasm.File(path, 'r');
  try {
    const data = file.get('data');
    const [, height, width] = data.shape;
    const values = data.value;
    const dqf = file.get('dqf').value;
    const lat = Float64Array.from(file.get('lat').slice([[0, height], [0, 1]]));
    const lon = Float64Array.from(file.get('lon').slice([[0, 1], [0, width]]));
    const counts = new Uint8Array(width * height);
    for (let i = 0; i < counts.length; i++) {
      const v = values[i];
      counts[i] = dqf[i] !== 0 || !(v >= 1 && v <= 255) ? 0 : Math.round(v);
    }
    const attr = (name) => (file.attrs[name] ? String(file.attrs[name].value) : null);
    const created = attr('date_created');
    return {
      width,
      height,
      counts,
      lat,
      lon,
      valid: new Date(attr('time_coverage_start')),
      created: created ? new Date(created) : null,
    };
  } finally {
    file.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
