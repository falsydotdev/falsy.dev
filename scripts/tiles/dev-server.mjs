// Vite plugin for `astro dev`: serves the locally baked tiles at /data without copying them
// into public/, which would put 1.5 GB into every build. `FALSY_TILES_<BODY>` serves one body
// from another folder, such as a small test bake: FALSY_TILES_EARTH=~/.cache/falsy-dev/earth-test/tiles/earth.
import { createReadStream, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { TILE_DIR } from './paths.mjs';

const TYPES = { '.avif': 'image/avif', '.bin': 'application/octet-stream', '.json': 'application/json' };

export function serveTiles() {
  return {
    name: 'falsy-serve-tiles',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/data', (req, res, next) => {
        const [, body = '', ...rest] = decodeURIComponent(new URL(req.url, 'http://x').pathname).split('/');
        if (!/^[a-z]+$/.test(body)) return next();
        const override = process.env[`FALSY_TILES_${body.toUpperCase()}`];
        const root = override ? resolve(override.replace(/^~(?=\/)/, homedir())) : join(TILE_DIR, body);
        const path = normalize(join(root, ...rest));
        if (!path.startsWith(root + sep)) return next();
        let size;
        try {
          const stat = statSync(path);
          if (!stat.isFile()) return next();
          size = stat.size;
        } catch {
          res.statusCode = 404;
          return res.end();
        }
        res.setHeader('Content-Type', TYPES[extname(path)] ?? 'application/octet-stream');
        res.setHeader('Content-Length', size);
        if (req.method === 'HEAD') return res.end();
        createReadStream(path).pipe(res);
      });
    },
  };
}
