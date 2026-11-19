import type { VitePWAOptions } from 'vite-plugin-pwa';
import { DEFAULT_GRAPHICS } from '../contracts/render';
import { ASSET_REGISTRY } from '../render/asset-registry';
import { QUALITY_FLAGS } from '../render/quality';

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

/** Assets the default preset does not draw, as `[stem, extensions]` of the hashed `stem-<hash>.ext`; the Basis transcoder is runtime-cached only while no KTX2 is precached. */
export const RUNTIME_ASSETS: readonly (readonly [string, readonly string[]])[] = (() => {
  const defaults = QUALITY_FLAGS[DEFAULT_GRAPHICS];
  const offByDefault = Object.entries(ASSET_REGISTRY).filter(([, { flag }]) => !defaults[flag]);
  const assets: [string, readonly string[]][] = offByDefault.map(([stem, { kind }]) => [
    stem,
    [kind],
  ]);
  const ktx2 = Object.values(ASSET_REGISTRY).filter(({ kind }) => kind === 'ktx2');
  if (ktx2.length > 0 && ktx2.every(({ flag }) => !defaults[flag])) {
    assets.push(['basis_transcoder', ['js', 'wasm']]);
  }
  return assets;
})();

/** Both are built from `RUNTIME_ASSETS`: precache skips these files, the service worker caches them on first use. */
const RUNTIME_ASSET_GLOBS = RUNTIME_ASSETS.flatMap(([stem, extensions]) =>
  extensions.map((extension) => `**/${stem}-*.${extension}`),
);
export const RUNTIME_ASSET_URLS = new RegExp(
  `/(?:${RUNTIME_ASSETS.map(([stem, extensions]) => `${stem}-[\\w-]+\\.(?:${extensions.join('|')})`).join('|')})$`,
);

/** Twice the runtime-cached files, so a rehash does not evict a live entry: the cache is all-or-nothing per texture set. */
const RUNTIME_CACHE_ENTRIES = RUNTIME_ASSET_GLOBS.length * 2;

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
          // Assets the default preset does not draw are cached on first use, not on install.
          urlPattern: RUNTIME_ASSET_URLS,
          handler: 'CacheFirst',
          options: {
            cacheName: 'ground-texture',
            cacheableResponse: { statuses: [200] },
            expiration: { maxEntries: RUNTIME_CACHE_ENTRIES },
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
