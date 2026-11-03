// Interim until the tile pipeline: links the prototype's Mars textures into public/data
// so the live scene can run locally. Builds them first if they're missing (about 31 MB).
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, symlinkSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const proto = resolve(root, 'prototypes/mars-orbit');
const source = resolve(proto, 'public/data');
const link = resolve(root, 'public/data');

if (!existsSync(resolve(source, 'meta.json'))) {
  if (!existsSync(resolve(proto, 'node_modules'))) execFileSync('npm', ['install'], { cwd: proto, stdio: 'inherit' });
  execFileSync('npm', ['run', 'data'], { cwd: proto, stdio: 'inherit' });
}

const linked = (() => {
  try {
    return lstatSync(link).isSymbolicLink();
  } catch {
    return false;
  }
})();
if (!linked) symlinkSync('../prototypes/mars-orbit/public/data', link, 'dir');
console.log(`public/data -> ${source}`);
