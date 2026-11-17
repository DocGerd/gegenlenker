import type { LayoutId, Marking, Obstacle } from './layout';
import type { InputChange, Pose2, Vec2 } from './sim';
import type { TrailerId, TruckId } from './vehicle';
/** Curriculum order, easiest first; the menu lists them in this order (`content.test.ts` pins it). */
export const EXERCISE_IDS = [
  'straight-reverse',
  'reverse-bay',
  'reverse-corner',
  'dock-ramp',
  'slalom',
] as const;
export type ExerciseId = (typeof EXERCISE_IDS)[number];
/** pose: trailer rear-end centre and trailer heading at the goal; the drawn zone extends `length` along pose.heading. */
export type TargetZone = {
  readonly pose: Pose2;
  readonly length: number;
  readonly width: number;
};
export type Tolerances = {
  readonly position: number; // m
  readonly angle: number; // degrees
};
export type ExerciseDefinition = {
  readonly id: ExerciseId;
  readonly layout: LayoutId;
  readonly start: Pose2;
  readonly target: TargetZone;
  readonly tolerances: Tolerances;
  readonly waypoint: Vec2 | null;
  readonly obstacles: readonly Obstacle[];
  readonly markings: readonly Marking[];
};
export type RunResult = {
  readonly exerciseId: ExerciseId;
  readonly truckId: TruckId;
  readonly trailerId: TrailerId;
  readonly reached: boolean;
  /** Any aid was on while the run drove. */
  readonly assisted: boolean;
  /** The exercise has a waypoint the run never came within range of. */
  readonly waypointMissed: boolean;
  readonly positionError: number;
  readonly angleError: number;
  readonly contacts: number;
  readonly jackknifes: number;
  readonly directionChanges: number;
  readonly time: number;
};
export type BestResults = Readonly<Record<string, RunResult>>;
export type InputLog = {
  readonly version: 1;
  readonly layoutId: LayoutId;
  readonly exerciseId: ExerciseId | null;
  readonly truckId: TruckId;
  readonly trailerId: TrailerId;
  readonly steps: number;
  readonly changes: readonly InputChange[];
};
