import type { VitePWAOptions } from 'vite-plugin-pwa';

export type TokenTheme = 'light' | 'dark';

export type PwaColors = { themeColor: string; backgroundColor: string };

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function tokenColor(css: string, name: string, theme: TokenTheme): string {
  const selector = theme === 'dark' ? "\\[data-theme='dark'\\]" : ':root';
  const block = css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`));
  const value = block?.[1]?.match(new RegExp(`${escapeRegExp(name)}:\\s*([^;]+);`))?.[1];
  if (!value) throw new Error(`Token ${name} not found in the ${theme} block of tokens.css`);
  return value.trim();
}

const icons = [
  { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: 'pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
];

/** Workbox skips larger files when precaching; the default, pinned so the cab glb test can import it. */
export const MAX_PRECACHE_FILE_BYTES = 2 * 1024 * 1024;

/** The hashed ground texture and its Basis transcoder; `globIgnores` below spells the same files as globs. */
const GROUND_ASSETS = /\/(?:ground-[\w-]+\.ktx2|basis_transcoder-[\w-]+\.(?:js|wasm))$/;

export function pwaOptions(base: string, colors: PwaColors): Partial<VitePWAOptions> {
  return {
    registerType: 'prompt',
    injectRegister: false,
    includeManifestIcons: false,
    manifest: {
      id: base,
      name: 'Gegenlenker',
      short_name: 'Gegenlenker',
      lang: 'de',
      start_url: base,
      scope: base,
      display: 'standalone',
      display_override: ['fullscreen', 'standalone'],
      theme_color: colors.themeColor,
      background_color: colors.backgroundColor,
      icons,
    },
    workbox: {
      globPatterns: ['**/*.{html,js,css,svg,png,jpg,webp,woff2,webmanifest,glb,gltf,ktx2,hdr}'],
      globIgnores: ['**/ground-*.ktx2', '**/basis_transcoder-*'],
      runtimeCaching: [
        {
          // Only High draws the ground texture, so the other presets do not pay for it on install.
          urlPattern: GROUND_ASSETS,
          handler: 'CacheFirst',
          options: {
            cacheName: 'ground-texture',
            cacheableResponse: { statuses: [200] },
            expiration: { maxEntries: 6 },
          },
        },
      ],
      maximumFileSizeToCacheInBytes: MAX_PRECACHE_FILE_BYTES,
      navigateFallback: 'index.html',
      cleanupOutdatedCaches: true,
      clientsClaim: true,
      skipWaiting: false,
    },
  };
}
