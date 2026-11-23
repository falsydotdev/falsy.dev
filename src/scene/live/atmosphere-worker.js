// Builds the atmosphere tables off the main thread; Earth's take about 250 ms.
import { buildTables } from '../atmosphere-luts.ts';

self.onmessage = ({ data: model }) => {
  const { transmittance, multi } = buildTables(model);
  self.postMessage({ transmittance, multi }, [transmittance.buffer, multi.buffer]);
};
