import type { ResolvedLayout } from '../contracts/layout';
import type { TrailerSpec, TruckSpec } from '../contracts/vehicle';
import { CONTACT_WARN_DISTANCE, PREDICT_STEP } from '../sim/constants';
import { CHEST_HEIGHT, HEAD_HEIGHT, layoutOccluders, sightGeometry } from './sight';
import { FOREARM, SHOULDER_HALF_SPAN, SHOULDER_HEIGHT, SIGN_POSES, UPPER_ARM } from './sign-poses';
import { EINWEISER_THRESHOLDS } from './signs';
import { HOLD_STEPS } from './track';
import { WALKER_RADIUS } from './walk';

/**
 * Bump when the reading rules (`signs.ts`, `sight.ts`), the Einweiser faults or `src/sim/predict.ts`
 * change behaviour, so stored Einweiser runs are dropped instead of replaying with other faults.
 * Driver tuning (`driver.ts`) needs none: its controls are logged.
 */
export const EINWEISER_REVISION = 1;

/**
 * What Einweiser runs hash beyond a driver run's scoring (`docs/einweiser-spike.md` §5): the shared
 * reading rules, and the data the derived faults read that `dataFingerprint` leaves out.
 */
export function einweiserScoring(
  truck: TruckSpec,
  trailer: TrailerSpec,
  layout: Pick<ResolvedLayout, 'obstacles' | 'decor'>,
): Readonly<Record<string, unknown>> {
  const { eye, glass, mirrors, heights } = sightGeometry(truck, trailer);
  return {
    ...EINWEISER_THRESHOLDS,
    EINWEISER_REVISION,
    sight: { eye, glass, mirrors, heights },
    // obstacle heights and decor: visual-only in driver runs
    occluders: layoutOccluders(layout),
    body: {
      HEAD_HEIGHT,
      CHEST_HEIGHT,
      WALKER_RADIUS,
      SHOULDER_HEIGHT,
      SHOULDER_HALF_SPAN,
      UPPER_ARM,
      FOREARM,
    },
    SIGN_POSES,
    // a replay tells a hold step he stood through (`moved` 0) from one he moved at
    HOLD_STEPS,
    // outside SIM_CONSTANTS, yet `contactAhead` (lateHalt) and `sweptBodies` (inPath) read them
    PREDICT_STEP,
    CONTACT_WARN_DISTANCE,
  };
}
