import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { pwaOptions, tokenColor } from './src/pwa/config';

const base = process.env.BASE_PATH ?? '/';
const tokens = readFileSync(resolve(import.meta.dirname, 'src/styles/tokens.css'), 'utf8');

const themeColorMeta: Plugin = {
  name: 'theme-color-from-tokens',
  transformIndexHtml: () =>
    (['light', 'dark'] as const).map((theme) => ({
      tag: 'meta',
      attrs: {
        name: 'theme-color',
        content: tokenColor(tokens, '--color-surface', theme),
        media: `(prefers-color-scheme: ${theme})`,
      },
      injectTo: 'head',
    })),
};

export default defineConfig({
  base,
  build: {
    assetsInlineLimit: (file) => (/\.(woff2?|glb|ktx2|wasm)$/.test(file) ? false : undefined),
  },
  plugins: [
    themeColorMeta,
    VitePWA(
      pwaOptions(base, {
        themeColor: tokenColor(tokens, '--color-surface', 'light'),
        backgroundColor: tokenColor(tokens, '--color-bg', 'light'),
      }),
    ),
  ],
});
