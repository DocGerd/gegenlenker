import type { RunResult, Tolerances } from '../contracts/exercise';

export type Criterion = {
  readonly id: 'position' | 'angle';
  readonly value: number;
  readonly limit: number;
  readonly passed: boolean;
};

export function criteria(r: RunResult, tolerances: Tolerances): readonly Criterion[] {
  return [
    {
      id: 'position',
      value: r.positionError,
      limit: tolerances.position,
      passed: r.positionError <= tolerances.position,
    },
    {
      id: 'angle',
      value: r.angleError,
      limit: tolerances.angle,
      passed: r.angleError <= tolerances.angle,
    },
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
