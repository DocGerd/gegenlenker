import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  build: {
    assetsInlineLimit: (file) => (/\.woff2?$/.test(file) ? false : undefined),
  },
});
