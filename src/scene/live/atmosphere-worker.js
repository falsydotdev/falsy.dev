// Builds the atmosphere tables off the main thread; they take about 100 ms.
import { buildMultiScatter, buildOpticalDepth } from '../atmosphere-luts.ts';

self.onmessage = ({ data: model }) => {
  const depth = buildOpticalDepth(model);
  const multi = buildMultiScatter(model, depth);
  self.postMessage({ depth, multi }, [depth.buffer, multi.buffer]);
};
