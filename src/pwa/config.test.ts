import { readdirSync, statSync, readFileSync } from 'node:fs';
import { matchesGlob, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GRAPHICS } from '../contracts/render';
import { ASSET_REGISTRY } from '../render/asset-registry';
import { QUALITY_FLAGS } from '../render/quality';
import { MAX_PRECACHE_FILE_BYTES, RUNTIME_CACHE_MIN_ENTRIES, pwaOptions } from './config';

const colors = { themeColor: '#ffffff', backgroundColor: '#ffffff' };
const manifest = pwaOptions('/gegenlenker/', colors).manifest;

/** Width and height from the PNG IHDR chunk. */
function pngSize(file: string): string {
  const bytes = readFileSync(resolve(import.meta.dirname, '../../public', file));
  return `${String(bytes.readUInt32BE(16))}x${String(bytes.readUInt32BE(20))}`;
}

describe('web app manifest', () => {
  it('declares icons that exist at their stated size, including a maskable one', () => {
    const icons = manifest === false ? [] : (manifest?.icons ?? []);
    expect(icons.map((i) => i.purpose)).toEqual(expect.arrayContaining(['any', 'maskable']));
    for (const icon of icons) expect(pngSize(icon.src), icon.src).toBe(icon.sizes);
  });

  it('keeps start_url, scope and id on the base path', () => {
    expect(manifest).toMatchObject({
      scope: '/gegenlenker/',
      start_url: '/gegenlenker/',
      id: '/gegenlenker/',
    });
  });
});

describe('runtime-cached texture assets', () => {
  const { workbox } = pwaOptions('/gegenlenker/', colors);
  const ignored = workbox?.globIgnores ?? [];
  const runtime = workbox?.runtimeCaching?.[0];
  const pattern = runtime?.urlPattern;
  const cached = (file: string): boolean =>
    pattern instanceof RegExp && pattern.test(`/gegenlenker/${file}`);
  const hashed = (glob: string): string =>
    `assets/${glob.replace('**/', '').replaceAll('*', 'AbC12_x')}`;

  it('ignores some files, and every ignored file is runtime-cached once fetched', () => {
    expect(ignored.length).toBeGreaterThan(0);
    expect(pattern).toBeInstanceOf(RegExp);
    for (const glob of ignored) {
      const file = hashed(glob);
      expect(matchesGlob(file, glob), glob).toBe(true);
      expect(cached(file), file).toBe(true);
    }
  });

  it('leaves precached files to the precache', () => {
    for (const file of [
      'assets/cab-AbC12_x.glb',
      'assets/index-AbC12_x.js',
      'assets/index-AbC12_x.css',
      'assets/ground.ktx2',
      'assets/sky-AbC12_x.png',
      'index.html',
    ]) {
      expect(cached(file), file).toBe(false);
    }
  });

  it('still precaches ktx2 files, apart from the ignored ones', () => {
    const [precache] = workbox?.globPatterns ?? [];
    expect(precache).toContain('ktx2');
  });

  it('keeps room for the live set plus one stale hashed set, never below the original size', () => {
    const maxEntries = runtime?.options?.expiration?.maxEntries ?? 0;
    const defaults = QUALITY_FLAGS[DEFAULT_GRAPHICS];
    const textures = Object.values(ASSET_REGISTRY).filter(({ flag }) => !defaults[flag]);
    const liveFiles = textures.length + (textures.length > 0 ? 2 : 0);
    expect(liveFiles).toBeGreaterThan(0);
    expect(maxEntries).toBeGreaterThanOrEqual(liveFiles * 2);
    expect(maxEntries).toBeGreaterThanOrEqual(RUNTIME_CACHE_MIN_ENTRIES);
  });
});

describe('asset registry', () => {
  const assetsDir = resolve(import.meta.dirname, '../render/assets');
  const binaries = readdirSync(assetsDir).filter((file) => /\.(glb|ktx2)$/.test(file));
  const { workbox } = pwaOptions('/gegenlenker/', colors);
  const ignored = workbox?.globIgnores ?? [];

  it('lists every glb and ktx2 in src/render/assets, and nothing else', () => {
    const stems = binaries.map((file) => file.replace(/\.[^.]+$/, '')).sort();
    expect(Object.keys(ASSET_REGISTRY).sort()).toEqual(stems);
  });

  it('runtime-caches the textures the default preset does not draw, with their transcoder', () => {
    expect([...ignored].sort()).toEqual([
      '**/basis_transcoder-*.js',
      '**/basis_transcoder-*.wasm',
      '**/ground-*.ktx2',
      '**/sky-*.ktx2',
      '**/yard-kit-*.glb',
      '**/yard-kit-atlas-a-*.ktx2',
      '**/yard-kit-atlas-b-*.ktx2',
      '**/yard-kit-leaves-*.ktx2',
    ]);
  });

  it('keeps every precached file within the precache size limit', () => {
    for (const file of binaries) {
      const stem = file.replace(/\.[^.]+$/, '');
      const hashed = `assets/${stem}-AbC12_x${file.slice(stem.length)}`;
      if (ignored.some((glob) => matchesGlob(hashed, glob))) continue;
      expect(statSync(resolve(assetsDir, file)).size, file).toBeLessThanOrEqual(
        MAX_PRECACHE_FILE_BYTES,
      );
    }
  });
});
