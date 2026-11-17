import type { RunResult, Tolerances } from '../contracts/exercise';
import { withinTolerance } from './score';

export type Criterion = {
  readonly id: 'position' | 'angle';
  readonly passed: boolean;
};

export function criteria(r: RunResult, tolerances: Tolerances): readonly Criterion[] {
  const ok = withinTolerance({ position: r.positionError, angle: r.angleError }, tolerances);
  return [
    { id: 'position', passed: ok.position },
    { id: 'angle', passed: ok.angle },
  ];
}

/** Position, angle and waypoint were fine and the run still failed: it ended while the vehicle moved. */
export function endedMoving(r: RunResult, tolerances: Tolerances): boolean {
  return !r.reached && !r.waypointMissed && criteria(r, tolerances).every((c) => c.passed);
}

export type Deltas = Readonly<
  Record<
    'positionError' | 'angleError' | 'contacts' | 'jackknifes' | 'directionChanges' | 'time',
    number
  >
>;

/** Run minus best: negative is better for every measure. */
export function deltasToBest(r: RunResult, best: RunResult): Deltas {
  return {
    positionError: r.positionError - best.positionError,
    angleError: r.angleError - best.angleError,
    contacts: r.contacts - best.contacts,
    jackknifes: r.jackknifes - best.jackknifes,
    directionChanges: r.directionChanges - best.directionChanges,
    time: r.time - best.time,
  };
}
