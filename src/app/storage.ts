import { exerciseById } from '../content/registry';
import { resolveRun } from '../content/run';
import type { BestResults, InputLog, RunResult } from '../contracts/exercise';
import {
  parseBestResults,
  recordBest,
  serializeBestResults,
  type ResultIds,
} from '../scoring/best';
import { MAX_REPLAY_STEPS, parseInputLog, serializeInputLog, type RunIds } from '../sim/replay';
import { NAMES } from './channel';

const { storagePrefix } = NAMES;
export const SETTINGS_KEY = `${storagePrefix}.settings.v1`;
export const BEST_KEY = `${storagePrefix}.best.v2`;
// Bests before the assisted/unaided split cannot be classified, so they are dropped.
const LEGACY_BEST_KEY = `${storagePrefix}.best.v1`;
export const LAST_RUN_KEY = `${storagePrefix}.lastRun.v1`;
export const WHATS_NEW_SEEN_KEY = `${storagePrefix}.whatsNewSeen.v1`;

const PROBE_KEY = `${storagePrefix}.probe`;

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

const fingerprints = new Map<string, string>();

/** Resolves the ids as drive and replay do, so a stored run matches only the data it was driven on. */
function runFingerprint(ids: RunIds): string {
  const key = `${ids.layoutId}/${ids.exerciseId}/${ids.truckId}/${ids.trailerId}`;
  let fingerprint = fingerprints.get(key);
  if (fingerprint === undefined) {
    fingerprint = resolveRun(ids).fingerprint;
    fingerprints.set(key, fingerprint);
  }
  return fingerprint;
}

const resultFingerprint = (r: ResultIds): string =>
  runFingerprint({ ...r, layoutId: exerciseById(r.exerciseId).layout });

// Held in memory as well, so a finished run shows its result when storage is unavailable.
let best: BestResults | null = null;

export function bestResults(): BestResults {
  if (best === null) {
    removeText(LEGACY_BEST_KEY);
    best = parseBestResults(readText(BEST_KEY), resultFingerprint);
  }
  return best;
}

/** `previous` is the best this run competed with, read before it was replaced. */
export function storeResult(result: RunResult): { isNewBest: boolean; previous: RunResult | null } {
  const recorded = recordBest(bestResults(), result);
  best = recorded.best;
  const json = serializeBestResults(best, resultFingerprint);
  if (!writeText(BEST_KEY, json)) {
    // A large old run log must not cost the driver their best result.
    removeText(LAST_RUN_KEY);
    writeText(BEST_KEY, json);
  }
  return { isNewBest: recorded.isNewBest, previous: recorded.previous };
}

export function isReplayable(log: InputLog): boolean {
  if (log.steps === 0 || log.steps > MAX_REPLAY_STEPS) return false;
  if (log.exerciseId === null) return true;
  return exerciseById(log.exerciseId).layout === log.layoutId;
}

// Held in memory as well, so a replay works when storage is unavailable or full.
let last: InputLog | null | undefined;

export function lastRun(): InputLog | null {
  if (last === undefined) {
    const log = parseInputLog(readText(LAST_RUN_KEY), runFingerprint);
    last = log !== null && isReplayable(log) ? log : null;
  }
  return last;
}

export function storeLastRun(log: InputLog): void {
  if (log.steps === 0) return;
  last = isReplayable(log) ? log : null;
  // A failed write must not leave an older run behind to be replayed after a reload.
  if (last === null || !writeText(LAST_RUN_KEY, serializeInputLog(log, runFingerprint)))
    removeText(LAST_RUN_KEY);
}
