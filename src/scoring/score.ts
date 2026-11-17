import type { ExerciseDefinition, RunResult, TargetZone } from '../contracts/exercise';
import type { SimSnapshot } from '../contracts/sim';
import type { TrailerId, TruckId } from '../contracts/vehicle';
import { wrapAngle } from '../sim/angle';

export const WAYPOINT_RADIUS = 3; // m, truck rear axle to waypoint

export const STOPPED_SPEED = 0.05; // m/s

export function targetError(s: SimSnapshot, zone: TargetZone): { position: number; angle: number } {
  return {
    position: Math.hypot(s.trailerRear.x - zone.pose.x, s.trailerRear.y - zone.pose.y),
    angle: (Math.abs(wrapAngle(s.trailer.heading - zone.pose.heading)) * 180) / Math.PI,
  };
}

function stoppedInTarget(s: SimSnapshot, exercise: ExerciseDefinition): boolean {
  const e = targetError(s, exercise.target);
  return (
    Math.abs(s.speed) < STOPPED_SPEED &&
    e.position <= exercise.tolerances.position &&
    e.angle <= exercise.tolerances.angle
  );
}

export function createRunTracker(exercise: ExerciseDefinition): {
  update(s: SimSnapshot): boolean;
} {
  const waypoint = exercise.waypoint;
  let waypointVisited = waypoint === null;
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
  };
}

/** `reached` is the last `RunTracker.update` result: the snapshot alone cannot know the waypoint. */
export function runResult(
  s: SimSnapshot,
  exercise: ExerciseDefinition,
  truckId: TruckId,
  trailerId: TrailerId,
  reached: boolean,
): RunResult {
  const e = targetError(s, exercise.target);
  return {
    exerciseId: exercise.id,
    truckId,
    trailerId,
    reached,
    positionError: e.position,
    angleError: e.angle,
    contacts: s.contacts,
    jackknifes: s.jackknifes,
    directionChanges: s.directionChanges,
    time: s.time,
  };
}
