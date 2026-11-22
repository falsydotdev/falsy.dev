// Downloads a body's sources and bakes its tiles: `npm run tiles -- --body moon`.
import { spawnSync } from 'node:child_process';
import { PIPELINE, bodyArg } from './paths.mjs';

for (const step of PIPELINE[bodyArg()].steps ?? ['fetch-sources', 'heights', 'colour']) {
  const { status } = spawnSync(process.execPath, [new URL(`./${step}.mjs`, import.meta.url).pathname, ...process.argv.slice(2)], { stdio: 'inherit' });
  if (status) process.exit(status);
}
