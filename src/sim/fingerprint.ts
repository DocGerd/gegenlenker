import type { ExerciseDefinition } from '../contracts/exercise';
import type { ResolvedLayout } from '../contracts/layout';
import type { Pose2 } from '../contracts/sim';
import type { VehicleParams } from '../contracts/vehicle';
import {
  ACCEL,
  BRAKE_DECEL,
  DECEL,
  DRAWBAR_WIDTH,
  DT,
  EVENT_CLEAR_DISTANCE,
  V_MAX,
} from './constants';

// The constants the simulation steps with; a literal, as namespace key order differs between bundle and test runner.
const constants = { DT, V_MAX, ACCEL, DECEL, BRAKE_DECEL, DRAWBAR_WIDTH, EVENT_CLEAR_DISTANCE };

/** FNV-1a over everything a run's path depends on, so stored runs from other data can be told apart. */
export function dataFingerprint(
  params: VehicleParams,
  layout: ResolvedLayout,
  start: Pose2,
  exercise: ExerciseDefinition | null,
): string {
  const text = JSON.stringify([params, layout, start, exercise, constants]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
