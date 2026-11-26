/*
 * The precache covers what the default preset draws; the service worker caches the other
 * presets' assets on first fetch (src/pwa/config.ts). Fetching a preset's assets while online
 * under worker control makes it work offline without having been drawn once.
 */

export type PresetCacheHost = {
  /** What the saved preset draws. */
  readonly urls: () => readonly string[];
  readonly online: () => boolean;
  /** Whether a service worker answers this page's fetches. */
  readonly controlled: () => boolean;
  readonly cached: (url: string) => Promise<boolean>;
  /** Fetches `url` to the end, rejecting on a failed request. */
  readonly download: (url: string) => Promise<void>;
  readonly sleep: (ms: number) => Promise<void>;
};

/** The worker answers before its cache write finishes. */
const SETTLE_POLLS = 20;
const SETTLE_POLL_MS = 100;

async function missing(host: PresetCacheHost, urls: readonly string[]): Promise<string[]> {
  const found = await Promise.all(urls.map((url) => host.cached(url)));
  return urls.filter((_, i) => !found[i]);
}

async function settled(host: PresetCacheHost, urls: readonly string[]): Promise<boolean> {
  for (let poll = 0; poll < SETTLE_POLLS; poll++) {
    if ((await missing(host, urls)).length === 0) return true;
    await host.sleep(SETTLE_POLL_MS);
  }
  return false;
}

/** Whether every URL is cached once the missing ones are fetched, which needs a connection and a controlled page. */
export async function cacheAssets(
  host: PresetCacheHost,
  urls: readonly string[],
): Promise<boolean> {
  const absent = await missing(host, urls);
  if (absent.length === 0) return true;
  if (!host.online() || !host.controlled()) return false;
  try {
    for (const url of absent) await host.download(url);
  } catch (error) {
    console.warn('Offline caching of the graphics assets failed', error);
    return false;
  }
  return settled(host, absent);
}

/**
 * `refresh` reports whether the saved preset is fully cached: first from what is cached, then
 * after fetching the rest. A newer call supersedes an older one's report.
 */
export function createPresetCache(
  host: PresetCacheHost,
  report: (ready: boolean) => void,
): { readonly refresh: () => Promise<void> } {
  let generation = 0;
  return {
    async refresh() {
      const mine = ++generation;
      const urls = host.urls();
      const ready = (await missing(host, urls)).length === 0;
      if (mine !== generation) return;
      report(ready);
      if (ready) return;
      const complete = await cacheAssets(host, urls);
      if (mine === generation) report(complete);
    },
  };
}

export const browserHost = (urls: () => readonly string[]): PresetCacheHost => ({
  urls,
  online: () => navigator.onLine,
  controlled: () => navigator.serviceWorker.controller !== null,
  cached: async (url) => (await caches.match(url)) !== undefined,
  download: async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${String(response.status)}`);
    await response.arrayBuffer();
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});
