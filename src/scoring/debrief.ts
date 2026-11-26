import {
  EINWEISER_FAULTS,
  type EinweiserFault,
  type EinweiserResult,
} from '../contracts/einweiser';
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

/** Run minus best: negative is better for every measure. Null unless both reached the target. */
export function deltasToBest(r: RunResult, best: RunResult): Deltas | null {
  if (!r.reached || !best.reached) return null;
  return {
    positionError: r.positionError - best.positionError,
    angleError: r.angleError - best.angleError,
    contacts: r.contacts - best.contacts,
    jackknifes: r.jackknifes - best.jackknifes,
    directionChanges: r.directionChanges - best.directionChanges,
    time: r.time - best.time,
  };
}

/**
 * What binds an Einweiser fault (`docs/einweiser-spike.md` §4): DGUV Vorschrift 70 §46(2) (stay in the
 * driver's sight; he stops when he loses it), ASR A1.3 Nr. 5.7 (signs easy to give and to recognise), or
 * the trainer's own convention where no source sets a rule.
 */
export type FaultBasis = 'dguv70' | 'asr' | 'trainer';

export const FAULT_BASIS: Readonly<Record<EinweiserFault, FaultBasis>> = {
  inPath: 'trainer',
  tooClose: 'trainer',
  outOfSight: 'dguv70',
  signOutOfSight: 'dguv70',
  unclear: 'asr',
  lateHalt: 'trainer',
  noAchtung: 'trainer',
};

export type FaultLine = {
  readonly fault: EinweiserFault;
  readonly count: number;
  readonly basis: FaultBasis;
};

/** One line per fault kind, in contract order, zero counts included. */
export const faultLines = (e: EinweiserResult): readonly FaultLine[] =>
  EINWEISER_FAULTS.map((fault) => ({ fault, count: e.faults[fault], basis: FAULT_BASIS[fault] }));
