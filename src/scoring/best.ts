import { EXERCISE_IDS } from '../contracts/exercise';
import type { BestResults, ExerciseId, RunResult } from '../contracts/exercise';
import { DEFAULT_LIGHTING, LIGHTING_MODES, type LightingMode } from '../contracts/render';
import { TRAILER_IDS, TRUCK_IDS } from '../contracts/vehicle';
import type { TrailerId, TruckId } from '../contracts/vehicle';

const STORAGE_VERSION = 2;

/** The trailer segment of a solo run's key: no trailer id. */
export const SOLO_KEY = 'solo';

/**
 * Assisted and unaided runs rank apart: an aid must not beat an unaided best. Night and mirror-only
 * runs rank apart too; the default keys carry no suffix, so bests stored before either existed stay valid.
 */
export function bestKey(
  exerciseId: ExerciseId,
  truckId: TruckId,
  trailerId: TrailerId | null,
  assisted: boolean,
  lighting: LightingMode,
  mirrorsOnly: boolean,
): string {
  const base = `${exerciseId}/${truckId}/${trailerId ?? SOLO_KEY}/${assisted ? 'assisted' : 'unaided'}`;
  return `${base}${lighting === 'night' ? '/night' : ''}${mirrorsOnly ? '/mirrors' : ''}`;
}

export const resultKey = (r: RunResult): string =>
  bestKey(r.exerciseId, r.truckId, r.trailerId, r.assisted, r.lighting, r.mirrorsOnly);

/** Negative when `a` is better. */
export function compareResults(a: RunResult, b: RunResult): number {
  // Only reached runs are recorded; this orders a stored miss from before that rule below any hit.
  if (a.reached !== b.reached) return a.reached ? -1 : 1;
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
): { best: BestResults; isNewBest: boolean; previous: RunResult | null } {
  const key = resultKey(r);
  const current = best[key] ?? null;
  // A miss never becomes or replaces a best; stored misses from before this rule still lose to any hit.
  if (!r.reached || (current !== null && compareResults(r, current) >= 0)) {
    return { best, isNewBest: false, previous: current };
  }
  return { best: { ...best, [key]: r }, isNewBest: true, previous: current };
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
  // Stored before lighting existed: drawn by day.
  const lighting = 'lighting' in r ? r.lighting : DEFAULT_LIGHTING;
  // Stored before mirror-only runs existed: driven with the top-down view.
  const mirrorsOnly = 'mirrorsOnly' in r ? r.mirrorsOnly : false;
  if (
    !EXERCISE_IDS.some((id) => id === exerciseId) ||
    !TRUCK_IDS.some((id) => id === truckId) ||
    (trailerId !== null && !TRAILER_IDS.some((id) => id === trailerId)) ||
    !LIGHTING_MODES.some((mode) => mode === lighting) ||
    typeof r.reached !== 'boolean' ||
    typeof r.assisted !== 'boolean' ||
    typeof mirrorsOnly !== 'boolean' ||
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
    trailerId: trailerId as TrailerId | null,
    reached: r.reached,
    assisted: r.assisted,
    lighting: lighting as LightingMode,
    mirrorsOnly,
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
    if (r === null || resultKey(r) !== key) continue;
    if ((value as Record<string, unknown>).fingerprint === fingerprint(r)) out[key] = r;
  }
  return out;
}
