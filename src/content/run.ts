import type { ExerciseDefinition } from '../contracts/exercise';
import type { ResolvedLayout } from '../contracts/layout';
import type { ContactQuery, StartState } from '../contracts/sim';
import type { VehicleParams } from '../contracts/vehicle';
import { SCORING_THRESHOLDS } from '../scoring/score';
import { createContactQuery } from '../sim/collision';
import { dataFingerprint } from '../sim/fingerprint';
import type { RunIds } from '../sim/replay';
import { trailerById, truckById } from '../vehicles/registry';
import { resolveCombination } from '../vehicles/resolve';
import { exerciseById, layouts } from './registry';
import { resolveLayout } from './resolve-layout';

export type ResolvedRun = {
  readonly params: VehicleParams;
  readonly layout: ResolvedLayout;
  readonly exercise: ExerciseDefinition | null;
  readonly start: StartState;
  readonly contacts: ContactQuery;
  /** Identifies the data the run is simulated on, so stored runs match only that data. */
  readonly fingerprint: string;
};

/** The single place that turns a run's ids into what drive, replay and storage simulate and hash. */
export function resolveRun(ids: RunIds): ResolvedRun {
  const params = resolveCombination(truckById(ids.truckId), trailerById(ids.trailerId));
  const exercise = ids.exerciseId === null ? null : exerciseById(ids.exerciseId);
  const layout = resolveLayout(layouts[ids.layoutId], exercise);
  const pose = exercise?.start ?? layouts[ids.layoutId].start;
  const bend = exercise?.startArticulation;
  const start: StartState =
    bend === undefined
      ? { truck: pose }
      : { truck: pose, couplingAngle: bend.coupling, turntableAngle: bend.turntable };
  return {
    params,
    layout,
    exercise,
    start,
    contacts: createContactQuery(layout.obstacles),
    fingerprint: dataFingerprint({
      params,
      obstacles: layout.obstacles,
      start: pose,
      exercise,
      scoring: SCORING_THRESHOLDS,
    }),
  };
}
