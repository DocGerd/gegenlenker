import { EXERCISE_IDS } from '../contracts/exercise';
import type { BestResults, ExerciseId, RunResult } from '../contracts/exercise';
import { TRAILER_IDS, TRUCK_IDS } from '../contracts/vehicle';
import type { TrailerId, TruckId } from '../contracts/vehicle';

const STORAGE_VERSION = 1;

export function bestKey(exerciseId: ExerciseId, truckId: TruckId, trailerId: TrailerId): string {
  return `${exerciseId}/${truckId}/${trailerId}`;
}

/** Negative when `a` is better. */
export function compareResults(a: RunResult, b: RunResult): number {
  if (a.reached !== b.reached) return a.reached ? -1 : 1;
  // Unreached runs rank by closeness first, so quitting at once never becomes an unbeatable best.
  if (!a.reached) {
    const closer = a.positionError - b.positionError || a.angleError - b.angleError;
    if (closer !== 0) return closer;
  }
  return (
    a.contacts + a.jackknifes - (b.contacts + b.jackknifes) ||
    a.directionChanges - b.directionChanges ||
    a.time - b.time
  );
}

/** Reached with any vehicle pair. */
export function exerciseDone(best: BestResults, exerciseId: ExerciseId): boolean {
  return Object.values(best).some((r) => r.exerciseId === exerciseId && r.reached);
}

export function recordBest(
  best: BestResults,
  r: RunResult,
): { best: BestResults; isNewBest: boolean } {
  const key = bestKey(r.exerciseId, r.truckId, r.trailerId);
  const current = best[key];
  if (current !== undefined && compareResults(r, current) >= 0) {
    return { best, isNewBest: false };
  }
  return { best: { ...best, [key]: r }, isNewBest: true };
}

export type ResultIds = Pick<RunResult, 'exerciseId' | 'truckId' | 'trailerId'>;

export function serializeBestResults(
  best: BestResults,
  fingerprint: (ids: ResultIds) => string,
): string {
  const results = Object.fromEntries(
    Object.entries(best).map(([key, r]) => [key, { ...r, fingerprint: fingerprint(r) }]),
  );
  return JSON.stringify({ version: STORAGE_VERSION, results });
}

function isCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

function isMeasure(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

function toResult(v: unknown): RunResult | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  const { exerciseId, truckId, trailerId } = r;
  if (
    !EXERCISE_IDS.some((id) => id === exerciseId) ||
    !TRUCK_IDS.some((id) => id === truckId) ||
    !TRAILER_IDS.some((id) => id === trailerId) ||
    typeof r.reached !== 'boolean' ||
    !isMeasure(r.positionError) ||
    !isMeasure(r.angleError) ||
    !isCount(r.contacts) ||
    !isCount(r.jackknifes) ||
    !isCount(r.directionChanges) ||
    !isMeasure(r.time)
  ) {
    return null;
  }
  return {
    exerciseId: exerciseId as ExerciseId,
    truckId: truckId as TruckId,
    trailerId: trailerId as TrailerId,
    reached: r.reached,
    waypointMissed: r.waypointMissed === true,
    positionError: r.positionError,
    angleError: r.angleError,
    contacts: r.contacts,
    jackknifes: r.jackknifes,
    directionChanges: r.directionChanges,
    time: r.time,
  };
}

/** Drops each entry not stored for the data `fingerprint` now reports for its ids. */
export function parseBestResults(
  raw: string | null,
  fingerprint: (ids: ResultIds) => string,
): BestResults {
  if (raw === null) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof data !== 'object' || data === null) return {};
  const { version, results } = data as Record<string, unknown>;
  if (version !== STORAGE_VERSION || typeof results !== 'object' || results === null) return {};
  const out: Record<string, RunResult> = {};
  for (const [key, value] of Object.entries(results)) {
    const r = toResult(value);
    if (r === null || bestKey(r.exerciseId, r.truckId, r.trailerId) !== key) continue;
    if ((value as Record<string, unknown>).fingerprint === fingerprint(r)) out[key] = r;
  }
  return out;
}
