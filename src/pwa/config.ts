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

/** The High-only textures and their Basis transcoder as `[stem, extensions]` of the hashed `stem-<hash>.ext`. */
const RUNTIME_ASSETS = [
  ['ground', ['ktx2']],
  ['sky', ['ktx2']],
  ['basis_transcoder', ['js', 'wasm']],
] as const;

/** Both are built from `RUNTIME_ASSETS`: precache skips these files, the service worker caches them on first use. */
const RUNTIME_ASSET_GLOBS = RUNTIME_ASSETS.flatMap(([stem, extensions]) =>
  extensions.map((extension) => `**/${stem}-*.${extension}`),
);
export const RUNTIME_ASSET_URLS = new RegExp(
  `/(?:${RUNTIME_ASSETS.map(([stem, extensions]) => `${stem}-[\\w-]+\\.(?:${extensions.join('|')})`).join('|')})$`,
);

export const PRECACHE_GLOBS = [
  '**/*.{html,js,css,svg,png,jpg,webp,woff2,webmanifest,glb,gltf,ktx2,hdr}',
];

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
      globPatterns: PRECACHE_GLOBS,
      globIgnores: RUNTIME_ASSET_GLOBS,
      runtimeCaching: [
        {
          // Only High draws these textures, so the other presets do not pay for them on install.
          urlPattern: RUNTIME_ASSET_URLS,
          handler: 'CacheFirst',
          options: {
            cacheName: 'ground-texture',
            cacheableResponse: { statuses: [200] },
            expiration: { maxEntries: 12 },
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
