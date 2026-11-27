import type { EinweiserResult, SignId } from './einweiser';
import type { LayoutId, Marking, Obstacle } from './layout';
import type { LightingMode } from './render';
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
/** Radians, signed as `couplingAngle` and `turntableAngle` in the snapshot. */
export type StartArticulation = {
  readonly coupling: number;
  readonly turntable: number;
};
export type ExerciseDefinition = {
  readonly id: ExerciseId;
  readonly layout: LayoutId;
  readonly start: Pose2;
  /** The combination starts bent; absent means straight. */
  readonly startArticulation?: StartArticulation;
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
  /** Bests rank apart per lighting, like `assisted`. */
  readonly lighting: LightingMode;
  /** Driven without the top-down view; ranks apart too. */
  readonly mirrorsOnly: boolean;
  /** The exercise has a waypoint the run never came within range of. */
  readonly waypointMissed: boolean;
  readonly positionError: number;
  readonly angleError: number;
  readonly contacts: number;
  readonly jackknifes: number;
  readonly directionChanges: number;
  readonly time: number;
  /** Present exactly for an Einweiser run. */
  readonly einweiser?: EinweiserResult;
};
export type BestResults = Readonly<Record<string, RunResult>>;
export const ROLES = ['driver', 'einweiser'] as const;
export type Role = (typeof ROLES)[number];
/** The Einweiser's held pose (`docs/einweiser-spike.md` §5): metres and radians in the sim plane. */
export type EinweiserSample = {
  readonly step: number;
  readonly x: number;
  readonly y: number;
  readonly heading: number;
  readonly pitch: number;
};
/** Change-only. Replays derive the Einweiser's view and faults from it; the logged controls alone drive the vehicle. */
export type EinweiserTrack = {
  readonly samples: readonly EinweiserSample[];
  readonly signs: readonly { readonly step: number; readonly sign: SignId | null }[];
};
export type InputLog = {
  readonly version: 4;
  readonly role: Role;
  /** Present exactly when `role` is `'einweiser'`. */
  readonly einweiser?: EinweiserTrack;
  readonly layoutId: LayoutId;
  readonly exerciseId: ExerciseId | null;
  readonly truckId: TruckId;
  readonly trailerId: TrailerId;
  readonly lighting: LightingMode;
  readonly mirrorsOnly: boolean;
  readonly steps: number;
  readonly changes: readonly InputChange[];
};
