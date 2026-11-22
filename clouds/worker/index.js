import { Container } from '@cloudflare/containers';
import shots from '../../scripts/posters/shots.json';
import { runJob } from './job.js';
import { posterMoments } from './keep.js';

export class CloudContainer extends Container {
  defaultPort = 8080;
  sleepAfter = '2m';
}

// The first start pulls the image, which can outlast the library's default 8 s and 20 s waits.
const START = { cancellationOptions: { instanceGetTimeoutMS: 120_000, portReadyTimeoutMS: 120_000 } };

export default {
  async scheduled(_controller, env) {
    const stub = env.CLOUD_CONTAINER.getByName('clouds');
    const container = {
      async fetch(url, init) {
        await stub.startAndWaitForPorts(START);
        return stub.fetch(url, init);
      },
    };
    const result = await runJob({
      bucket: env.CLOUDS,
      fetch: (url, init) => fetch(url, init),
      container,
      now: new Date(),
      keep: posterMoments(shots),
    });
    // A failed invocation shows in the cron event log, where a notification can pick it up.
    if (result.alert) throw new Error('Clouds are stale');
  },
};
