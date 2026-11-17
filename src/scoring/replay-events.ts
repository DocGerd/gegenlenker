import type { ExerciseDefinition, InputLog } from '../contracts/exercise';
import type { SimSnapshot } from '../contracts/sim';
import { createRunTracker, isDrivingInput, STOPPED_SPEED } from './score';

export type ReplayEventKind = 'contact' | 'jackknife' | 'stop' | 'waypoint' | 'reached';

/** `step` is the number of sim steps taken when the event shows. */
export type ReplayEvent = { readonly kind: ReplayEventKind; readonly step: number };

/** The step the scored run clock starts at: the first driving input, or the log's end when there is none. */
export function runStartStep(log: InputLog): number {
  return log.changes.find((c) => isDrivingInput(c.control))?.step ?? log.steps;
}

export type EventScanner = {
  update(s: SimSnapshot): void;
  events(): readonly ReplayEvent[];
};

/**
 * Feed every snapshot in order. A stop is the vehicle falling below the stop speed after it
 * moved; the stop that ends a reached run is reported as `reached` only.
 */
export function createEventScanner(exercise: ExerciseDefinition | null): EventScanner {
  const tracker = exercise === null ? null : createRunTracker(exercise);
  const events: ReplayEvent[] = [];
  let contacts = 0;
  let jackknifes = 0;
  let moving = false;
  let waypointSeen = tracker?.waypointVisited() ?? true;
  let reached = false;
  return {
    update(s) {
      const found: ReplayEventKind[] = [];
      if (s.contacts > contacts) found.push('contact');
      if (s.jackknifes > jackknifes) found.push('jackknife');
      contacts = s.contacts;
      jackknifes = s.jackknifes;
      const stopped = Math.abs(s.speed) < STOPPED_SPEED;
      const isReached = tracker?.update(s) === true;
      if (tracker !== null && !waypointSeen && tracker.waypointVisited()) {
        waypointSeen = true;
        found.push('waypoint');
      }
      if (isReached && !reached) {
        reached = true;
        found.push('reached');
      } else if (moving && stopped) found.push('stop');
      moving = !stopped;
      for (const kind of found) events.push({ kind, step: s.step });
    },
    events: () => events,
  };
}
