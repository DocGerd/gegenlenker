import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { pwaOptions, tokenColor } from './src/pwa/config';
import { releaseState } from './tools/changelog';

const base = process.env.BASE_PATH ?? '/';
const tokens = readFileSync(resolve(import.meta.dirname, 'src/styles/tokens.css'), 'utf8');

const gitCommit = (): string => {
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
      cwd: import.meta.dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (error) {
    if (process.env['CI'])
      throw new Error('cannot read the commit for a development build', { cause: error });
    return 'unknown';
  }
};

// A release build shows its version only, so it embeds no commit: the tree alone decides its bytes.
const build = releaseState(import.meta.dirname);

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
  define: { __BUILD__: JSON.stringify({ ...build, commit: build.release ? '' : gitCommit() }) },
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
