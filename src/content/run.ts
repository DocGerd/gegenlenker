import type { ExerciseDefinition } from '../contracts/exercise';
import type { ResolvedLayout } from '../contracts/layout';
import type { ContactQuery, StartState } from '../contracts/sim';
import {
  hasTrailer,
  type RigParams,
  type TrailerSpec,
  type TruckSpec,
  type VehicleParams,
} from '../contracts/vehicle';
import { einweiserScoring } from '../einweiser/fingerprint';
import { SCORING_THRESHOLDS } from '../scoring/score';
import { createContactQuery } from '../sim/collision';
import { dataFingerprint, type RunData } from '../sim/fingerprint';
import type { RunIds } from '../sim/replay';
import { trailerById, truckById } from '../vehicles/registry';
import { resolveRig } from '../vehicles/resolve';
import { exerciseById, layouts } from './registry';
import { resolveLayout } from './resolve-layout';

export type ResolvedRun = {
  readonly truck: TruckSpec;
  /** Null: the truck solo. */
  readonly trailer: TrailerSpec | null;
  readonly params: RigParams;
  readonly layout: ResolvedLayout;
  readonly exercise: ExerciseDefinition | null;
  readonly start: StartState;
  readonly contacts: ContactQuery;
  /** Identifies the data the run is simulated on, so stored runs match only that data. */
  readonly fingerprint: string;
};

/** The single place that turns a run's ids into what drive, replay and storage simulate and hash. */
export function resolveRun(ids: RunIds): ResolvedRun {
  const truck = truckById(ids.truckId);
  const trailer = ids.trailerId === null ? null : trailerById(ids.trailerId);
  const params = resolveRig(truck, trailer);
  const exercise = ids.exerciseId === null ? null : exerciseById(ids.exerciseId);
  const layout = resolveLayout(layouts[ids.layoutId], exercise);
  const pose = exercise?.start ?? layouts[ids.layoutId].start;
  const bend = trailer === null ? undefined : exercise?.startArticulation;
  const start: StartState =
    bend === undefined
      ? { truck: pose }
      : { truck: pose, couplingAngle: bend.coupling, turntableAngle: bend.turntable };
  // Driver runs hash exactly the driver thresholds, so their stored runs keep their fingerprints.
  const scoring: RunData['scoring'] =
    ids.role === 'einweiser'
      ? { ...SCORING_THRESHOLDS, ...einweiserScoring(truck, trailer, layout) }
      : SCORING_THRESHOLDS;
  return {
    truck,
    trailer,
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
      scoring,
    }),
  };
}

/** A run of the truck with its trailer. */
export type PairedRun = ResolvedRun & {
  readonly trailer: TrailerSpec;
  readonly params: VehicleParams;
};

export function pairedRun(ids: RunIds): PairedRun {
  const run = resolveRun(ids);
  const { trailer, params } = run;
  if (trailer === null || !hasTrailer(params)) throw new Error('a paired run has a trailer');
  return { ...run, trailer, params };
}
