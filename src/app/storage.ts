export const SETTINGS_KEY = 'gegenlenker.settings.v1';
export const BEST_KEY = 'gegenlenker.best.v1';
export const LAST_RUN_KEY = 'gegenlenker.lastRun.v1';

const PROBE_KEY = 'gegenlenker.probe';

let probed: Storage | null | undefined;

/** Null when storage is missing, blocked or full (private mode, disabled cookies). */
export function safeStorage(): Storage | null {
  if (probed !== undefined) return probed;
  try {
    const storage = window.localStorage;
    storage.setItem(PROBE_KEY, PROBE_KEY);
    storage.removeItem(PROBE_KEY);
    probed = storage;
  } catch {
    probed = null;
  }
  return probed;
}

export function readText(key: string): string | null {
  try {
    return safeStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeText(key: string, value: string): void {
  try {
    safeStorage()?.setItem(key, value);
  } catch {
    // Quota or revoked access: the value lives only for this session.
  }
}
