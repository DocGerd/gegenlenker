import type { ExerciseDefinition, RunResult, TargetZone, Tolerances } from '../contracts/exercise';
import type { LightingMode } from '../contracts/render';
import type { ControlVector, SimSnapshot } from '../contracts/sim';
import type { TrailerId, TruckId } from '../contracts/vehicle';
import { wrapAngle } from '../sim/angle';
import { DT } from '../sim/constants';

export const WAYPOINT_RADIUS = 3; // m, truck rear axle to waypoint

export const STOPPED_SPEED = 0.05; // m/s

/** Hashed whole into the data fingerprint; order is part of the fingerprint. */
export const SCORING_THRESHOLDS = { WAYPOINT_RADIUS, STOPPED_SPEED } as const;

export function targetError(s: SimSnapshot, zone: TargetZone): { position: number; angle: number } {
  return {
    position: Math.hypot(s.trailerRear.x - zone.pose.x, s.trailerRear.y - zone.pose.y),
    angle: (Math.abs(wrapAngle(s.trailer.heading - zone.pose.heading)) * 180) / Math.PI,
  };
}

/** The pass rule per criterion, shared by the live tracker and the debrief. */
export function withinTolerance(
  error: { position: number; angle: number },
  tolerances: Tolerances,
): { position: boolean; angle: boolean } {
  return {
    position: error.position <= tolerances.position,
    angle: error.angle <= tolerances.angle,
  };
}

function inTolerance(s: SimSnapshot, exercise: ExerciseDefinition): boolean {
  const ok = withinTolerance(targetError(s, exercise.target), exercise.tolerances);
  return ok.position && ok.angle;
}

function stoppedInTarget(s: SimSnapshot, exercise: ExerciseDefinition): boolean {
  return Math.abs(s.speed) < STOPPED_SPEED && inTolerance(s, exercise);
}

/** `away`: no cue (turn point pending or far from the target); `outside`: near the target but beyond a tolerance; `inside`: stopping now ends the run. */
export type GoalState = 'away' | 'outside' | 'inside';

/** Display data behind `GoalState`: the trailer rear's distance to the target in metres and which criterion holds. */
export type GoalCue = {
  state: GoalState;
  distance: number;
  positionOk: boolean;
  angleOk: boolean;
};

export type RunTracker = {
  update(s: SimSnapshot): boolean;
  goal(s: SimSnapshot): GoalState;
  goalCue(s: SimSnapshot): GoalCue;
  waypointVisited(): boolean;
};

export function createRunTracker(exercise: ExerciseDefinition): RunTracker {
  const waypoint = exercise.waypoint;
  let waypointVisited = waypoint === null;
  const cue = (s: SimSnapshot): GoalCue => {
    const error = targetError(s, exercise.target);
    const ok = withinTolerance(error, exercise.tolerances);
    let state: GoalState = 'away';
    if (waypointVisited) {
      if (ok.position && ok.angle) state = 'inside';
      else if (error.position <= exercise.target.length) state = 'outside';
    }
    return { state, distance: error.position, positionOk: ok.position, angleOk: ok.angle };
  };
  return {
    update(s) {
      if (
        !waypointVisited &&
        waypoint !== null &&
        Math.hypot(s.truck.x - waypoint.x, s.truck.y - waypoint.y) <= WAYPOINT_RADIUS
      ) {
        waypointVisited = true;
      }
      return waypointVisited && stoppedInTarget(s, exercise);
    },
    goal: (s) => cue(s).state,
    goalCue: cue,
    waypointVisited: () => waypointVisited,
  };
}

/** The run clock and the assisted flag start with the first input that can move the vehicle. */
export const isDrivingInput = (c: ControlVector): boolean => c.gear !== 'P' || c.lever > 0;

/** Run seconds at `step`: the same float expression as `runResult`'s `time` (snapshot time is `step * DT`), so both screens round alike. */
export const runSeconds = (step: number, startStep: number): number =>
  Math.max(0, step * DT - startStep * DT);

/** `reached` and `waypointVisited` come from the `RunTracker`: the snapshot alone cannot know the waypoint; `startTime` is the sim time of the first driving input. */
export function runResult(
  s: SimSnapshot,
  exercise: ExerciseDefinition,
  truckId: TruckId,
  trailerId: TrailerId | null,
  reached: boolean,
  waypointVisited: boolean,
  assisted: boolean,
  startTime: number,
  lighting: LightingMode,
  mirrorsOnly: boolean,
): RunResult {
  const e = targetError(s, exercise.target);
  return {
    exerciseId: exercise.id,
    truckId,
    trailerId,
    reached,
    assisted,
    lighting,
    mirrorsOnly,
    waypointMissed: exercise.waypoint !== null && !waypointVisited,
    positionError: e.position,
    angleError: e.angle,
    contacts: s.contacts,
    jackknifes: s.jackknifes,
    directionChanges: s.directionChanges,
    time: s.time - startTime,
  };
}
