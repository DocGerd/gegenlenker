import type { ExerciseDefinition } from '../contracts/exercise';
import type { Obstacle } from '../contracts/layout';
import type { JawCatch, Pose2 } from '../contracts/sim';
import type { RigParams } from '../contracts/vehicle';
import { SIM_CONSTANTS } from './constants';

// Bump when simulation, collision or scoring behaviour changes, so stored runs and replays of old
// behaviour are dropped. Not for which result is kept as the best (`recordBest`): a run's outcome is unchanged.
export const SIM_REVISION = 2;

/** What `JSON.stringify` keeps as is: a `Set`, a function or `undefined` would hash as `{}` or not at all. */
export type JsonData =
  number | string | boolean | null | readonly JsonData[] | { readonly [key: string]: JsonData };

export type RunData = {
  readonly params: RigParams;
  readonly obstacles: readonly Obstacle[];
  readonly start: Pose2;
  readonly exercise: ExerciseDefinition | null;
  /** Scoring thresholds and what else scoring reads, passed in so the sim layer does not depend on scoring. */
  readonly scoring: { readonly [key: string]: JsonData };
  /** Present exactly for a run that couples. */
  readonly jaw?: JawCatch;
};

/**
 * FNV-1a over what a run's path and score depend on, so stored runs from other data can be told apart.
 * Visual-only content (markings, surfaces, obstacle ids, heights and kinds) is left out; obstacle order
 * is hashed, since the first contact in list order is the one reported.
 */
export function dataFingerprint({
  params,
  obstacles,
  start,
  exercise,
  scoring,
  jaw,
}: RunData): string {
  const text = JSON.stringify([
    SIM_REVISION,
    params,
    obstacles.map(({ obb }) => [obb.cx, obb.cy, obb.halfLength, obb.halfWidth, obb.heading]),
    start,
    exercise && [
      exercise.target,
      exercise.tolerances,
      exercise.waypoint,
      ...(exercise.startArticulation === undefined ? [] : [exercise.startArticulation]),
      ...(exercise.parkedTrailer === undefined ? [] : [{ parkedTrailer: exercise.parkedTrailer }]),
    ],
    SIM_CONSTANTS,
    scoring,
    ...(jaw === undefined ? [] : [jaw]),
  ]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
