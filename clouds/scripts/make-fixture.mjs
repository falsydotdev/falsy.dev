// Writes a stride-decimated copy of a GMGSI file for the Node tests. Decimating instead of cropping
// keeps the ±72.7° coverage, the wrapped column 0, and the fill row.
// Usage: node clouds/scripts/make-fixture.mjs <GMGSI .nc> <out .nc> [stride]
import h5wasm from 'h5wasm/node';

const [input, output, strideArg = '16'] = process.argv.slice(2);
const stride = Number(strideArg);
await h5wasm.ready;
const src = new h5wasm.File(input, 'r');
const out = new h5wasm.File(output, 'w');

const [, rows, cols] = src.get('data').shape;
const h = Math.ceil(rows / stride);
const w = Math.ceil(cols / stride);
const plane = (name) => src.get(name).slice([[0, 1], [0, rows, stride], [0, cols, stride]]);
const grid = (name) => src.get(name).slice([[0, rows, stride], [0, cols, stride]]);
const write = (name, data, shape, dtype) =>
  out.create_dataset({ name, data, shape, dtype, chunks: shape, compression: 'gzip', compression_opts: 9 });

write('data', plane('data'), [1, h, w], '<f');
out.get('data').create_attribute('_FillValue', -9999, null, '<f');
write('dqf', plane('dqf'), [1, h, w], '<b');
write('lat', grid('lat'), [h, w], '<f');
write('lon', grid('lon'), [h, w], '<f');
for (const name of ['time_coverage_start', 'time_coverage_end', 'date_created', 'title']) {
  out.create_attribute(name, String(src.attrs[name].value));
}
out.create_attribute('history', `Decimated by ${stride} for tests from ${input.split('/').pop()}`);
src.close();
out.close();
console.log(`${output}: ${h}×${w}`);
