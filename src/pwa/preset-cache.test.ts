import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPresetCache, cacheAssets, type PresetCacheHost } from './preset-cache';

const URLS = ['/a.glb', '/b.ktx2'];

/** A service worker that stores what is downloaded, `lag` polls after the response. */
function host(over: Partial<PresetCacheHost> = {}, initial: string[] = [], lag = 0) {
  const store = new Set(initial);
  const pending: string[] = [];
  let polls = 0;
  const downloads: string[] = [];
  const h: PresetCacheHost = {
    urls: () => URLS,
    online: () => true,
    controlled: () => true,
    cached: (url) => {
      if (pending.length > 0 && polls++ >= lag) for (const u of pending.splice(0)) store.add(u);
      return Promise.resolve(store.has(url));
    },
    download: (url) => {
      downloads.push(url);
      pending.push(url);
      return Promise.resolve();
    },
    sleep: () => Promise.resolve(),
    ...over,
  };
  return { h, store, downloads };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cacheAssets', () => {
  it('downloads only what is missing and reports complete once it is cached', async () => {
    const { h, downloads } = host({}, ['/a.glb']);
    expect(await cacheAssets(h, URLS)).toBe(true);
    expect(downloads).toEqual(['/b.ktx2']);
  });

  it('waits for the worker to finish writing its cache', async () => {
    const { h } = host({}, [], 5);
    expect(await cacheAssets(h, URLS)).toBe(true);
  });

  it.each([
    ['offline', { online: () => false }],
    ['not controlled', { controlled: () => false }],
  ])('downloads nothing and reports incomplete when %s', async (_, over) => {
    const { h, downloads } = host(over);
    expect(await cacheAssets(h, URLS)).toBe(false);
    expect(downloads).toEqual([]);
  });

  it('reports incomplete when a download fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { h } = host({ download: () => Promise.reject(new Error('network')) });
    expect(await cacheAssets(h, URLS)).toBe(false);
  });

  it('reports incomplete when the worker never caches the file', async () => {
    const { h } = host({ download: () => Promise.resolve() });
    expect(await cacheAssets(h, URLS)).toBe(false);
  });
});

describe('createPresetCache', () => {
  it('reports incomplete first, then ready after fetching the rest', async () => {
    const { h } = host();
    const reports: boolean[] = [];
    await createPresetCache(h, (ready) => reports.push(ready)).refresh();
    expect(reports).toEqual([false, true]);
  });

  it('reports ready at once when everything is cached', async () => {
    const { h, downloads } = host({}, URLS);
    const reports: boolean[] = [];
    await createPresetCache(h, (ready) => reports.push(ready)).refresh();
    expect(reports).toEqual([true]);
    expect(downloads).toEqual([]);
  });

  it('lets a newer refresh supersede an older one', async () => {
    let preset = ['/a.glb'];
    const { h } = host({ urls: () => preset });
    const reports: boolean[] = [];
    const cache = createPresetCache(h, (ready) => reports.push(ready));
    const first = cache.refresh();
    preset = [];
    await Promise.all([first, cache.refresh()]);
    expect(reports).toEqual([true]);
  });
});
