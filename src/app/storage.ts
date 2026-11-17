import { exerciseById } from '../content/registry';
import type { BestResults, InputLog, RunResult } from '../contracts/exercise';
import { parseBestResults, recordBest, serializeBestResults } from '../scoring/best';
import { parseInputLog } from '../sim/replay';

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

/** False when the value was not stored (quota, revoked access): it then lives only for this session. */
export function writeText(key: string, value: string): boolean {
  try {
    const storage = safeStorage();
    storage?.setItem(key, value);
    return storage !== null;
  } catch {
    return false;
  }
}

export function removeText(key: string): void {
  try {
    safeStorage()?.removeItem(key);
  } catch {
    // Nothing stored that could be stale.
  }
}

// Held in memory as well, so a finished run shows its result when storage is unavailable.
let best: BestResults | null = null;

export function bestResults(): BestResults {
  best ??= parseBestResults(readText(BEST_KEY));
  return best;
}

/** Returns whether the run is a new best. */
export function storeResult(result: RunResult): boolean {
  const recorded = recordBest(bestResults(), result);
  best = recorded.best;
  const json = serializeBestResults(best);
  if (!writeText(BEST_KEY, json)) {
    // A large old run log must not cost the driver their best result.
    removeText(LAST_RUN_KEY);
    writeText(BEST_KEY, json);
  }
  return recorded.isNewBest;
}

// Bounds the snapshots a replay precomputes; a corrupt or hostile `steps` must not exhaust memory.
export const MAX_REPLAY_STEPS = 72_000;

export function isReplayable(log: InputLog): boolean {
  if (log.steps === 0 || log.steps > MAX_REPLAY_STEPS) return false;
  if (log.exerciseId === null) return true;
  return exerciseById(log.exerciseId).layout === log.layoutId;
}

// Held in memory as well, so a replay works when storage is unavailable or full.
let last: InputLog | null | undefined;

export function lastRun(): InputLog | null {
  if (last === undefined) {
    const log = parseInputLog(readText(LAST_RUN_KEY));
    last = log !== null && isReplayable(log) ? log : null;
  }
  return last;
}

export function storeLastRun(log: InputLog): void {
  if (log.steps === 0) return;
  last = isReplayable(log) ? log : null;
  // A failed write must not leave an older run behind to be replayed after a reload.
  if (last === null || !writeText(LAST_RUN_KEY, JSON.stringify(log))) removeText(LAST_RUN_KEY);
}
