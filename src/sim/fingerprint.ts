import type { ExerciseDefinition } from '../contracts/exercise';
import type { Obstacle } from '../contracts/layout';
import type { Pose2 } from '../contracts/sim';
import type { VehicleParams } from '../contracts/vehicle';
import { OVERLAP_EPSILON } from './collision';
import {
  ACCEL,
  BRAKE_DECEL,
  DECEL,
  DRAWBAR_WIDTH,
  DT,
  EVENT_CLEAR_DISTANCE,
  V_MAX,
} from './constants';

// Bump when simulation, collision or scoring behaviour changes.
export const SIM_REVISION = 2;

// A literal, as namespace key order differs between bundle and test runner.
const constants = {
  DT,
  V_MAX,
  ACCEL,
  DECEL,
  BRAKE_DECEL,
  DRAWBAR_WIDTH,
  EVENT_CLEAR_DISTANCE,
  OVERLAP_EPSILON,
};

export type RunData = {
  readonly params: VehicleParams;
  readonly obstacles: readonly Obstacle[];
  readonly start: Pose2;
  readonly exercise: ExerciseDefinition | null;
  /** Scoring thresholds, passed in so the sim layer does not depend on scoring. */
  readonly scoring: Readonly<Record<string, number>>;
};

/**
 * FNV-1a over what a run's path and score depend on, so stored runs from other data can be told apart.
 * Visual-only content (markings, surfaces, obstacle heights and kinds) is left out.
 */
export function dataFingerprint({ params, obstacles, start, exercise, scoring }: RunData): string {
  const text = JSON.stringify([
    SIM_REVISION,
    params,
    obstacles.map(({ id, obb }) => [
      id,
      obb.cx,
      obb.cy,
      obb.halfLength,
      obb.halfWidth,
      obb.heading,
    ]),
    start,
    exercise && [exercise.target, exercise.tolerances, exercise.waypoint],
    constants,
    scoring,
  ]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
