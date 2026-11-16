import type { BestResults, RunResult } from '../contracts/exercise';
import { parseBestResults, recordBest, serializeBestResults } from '../scoring/best';

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

// Held in memory as well, so a finished run shows its result when storage is unavailable.
let best: BestResults | null = null;

export function bestResults(): BestResults {
  best ??= parseBestResults(readText(BEST_KEY));
  return best;
}

export function storeResult(result: RunResult): void {
  best = recordBest(bestResults(), result).best;
  writeText(BEST_KEY, serializeBestResults(best));
}
