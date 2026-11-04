// Vite plugin for `astro dev`: serves the locally baked tiles at /data without copying them
// into public/, which would put 1.5 GB into every build.
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { TILE_DIR } from './paths.mjs';

const TYPES = { '.avif': 'image/avif', '.bin': 'application/octet-stream', '.json': 'application/json' };

export function serveTiles() {
  return {
    name: 'falsy-serve-tiles',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/data', (req, res, next) => {
        const path = normalize(join(TILE_DIR, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
        if (!path.startsWith(TILE_DIR + sep)) return next();
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
