import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://falsy.dev',
  trailingSlash: 'never',
  build: { format: 'file', inlineStylesheets: 'always' },
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  vite: {
    build: { target: 'es2022' },
  },
});
