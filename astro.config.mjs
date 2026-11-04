import { defineConfig } from 'astro/config';
import { serveTiles } from './scripts/tiles/dev-server.mjs';

export default defineConfig({
  site: 'https://falsy.dev',
  trailingSlash: 'never',
  build: { format: 'file', inlineStylesheets: 'always' },
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  vite: {
    build: { target: 'es2022' },
    plugins: [serveTiles()],
  },
});
