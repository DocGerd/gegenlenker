import type {
  BlockReason,
  BodyFootprint,
  ContactQuery,
  Prediction,
  SimSnapshot,
  Vec2,
} from '../contracts/sim';
import type { VehicleParams } from '../contracts/vehicle';
import { wrapAngle } from './angle';
import { CONTACT_WARN_DISTANCE, PREDICT_DISTANCE, PREDICT_STEP, PREDICT_SWEEP } from './constants';
import { bodyFootprints } from './geometry';
import { joints, pivotViolation, rk4, type KinematicState } from './kinematics';

export const NO_PREDICTION: Prediction = {
  trailer: [],
  truckOuter: [],
  truckInner: [],
  blocked: null,
  blockedAt: null,
  end: null,
};

const BISECTIONS = 6;
const MIN_PARTIAL = 0.03; // a shorter last piece is dropped, so a blocked start keeps a single point

/**
 * The paths of the trailer rear and the truck's swept corridor with the target steer held.
 * Unit speed makes time steps arc-length steps; the road wheels ramp toward the target along the
 * arc at the rate they would at the current speed, and reach it at once from standstill.
 */
export function predictCombination(
  params: VehicleParams,
  from: SimSnapshot,
  contacts: ContactQuery,
  distance = PREDICT_DISTANCE,
): Prediction {
  const { gear, steer } = from.control;
  if (gear !== 'D' && gear !== 'R') return NO_PREDICTION;
  const direction = gear === 'D' ? 1 : -1;
  const target = Math.min(1, Math.max(-1, steer)) * params.maxRoadWheelAngle;
  const speed = Math.abs(from.speed);
  const ramp = speed > 0 ? (params.steerRate * params.maxRoadWheelAngle) / speed : 0;
  const innerSide = target >= 0 ? 1 : -1; // the centre of the turn is on the side the wheels point to

  let memo: { q: KinematicState; bodies: readonly BodyFootprint[] } | null = null;
  const footprints = (q: KinematicState): readonly BodyFootprint[] => {
    if (memo?.q !== q) memo = { q, bodies: bodyFootprints(params, joints(params, q)) };
    return memo.bodies;
  };
  const rejection = (q: KinematicState): BlockReason | null => {
    const pivot = pivotViolation(params, q);
    if (pivot !== null) return pivot;
    return contacts(footprints(q)) === null ? null : 'contact';
  };

  const trailer: Vec2[] = [];
  const truckOuter: Vec2[] = [];
  const truckInner: Vec2[] = [];
  const recordTruck = (q: KinematicState): void => {
    const body = footprints(q)[0]?.obb;
    if (body === undefined) return;
    const [ux, uy] = [Math.cos(body.heading), Math.sin(body.heading)];
    const [nx, ny] = [-uy, ux];
    const outer = body.halfWidth * -innerSide;
    const inner = body.halfWidth * innerSide;
    truckOuter.push({
      x: body.cx + body.halfLength * ux + outer * nx,
      y: body.cy + body.halfLength * uy + outer * ny,
    });
    truckInner.push({ x: q.x + inner * nx, y: q.y + inner * ny });
  };
  const record = (q: KinematicState, truckLive: boolean): void => {
    trailer.push(joints(params, q).trailerRear);
    if (truckLive) recordTruck(q);
  };

  let q: KinematicState = {
    x: from.truck.x,
    y: from.truck.y,
    th0: from.truck.heading,
    th1: from.dolly.heading,
    th2: from.trailer.heading,
  };
  let delta = speed > 0 ? from.roadWheelAngle : target;
  let travelled = 0;
  let sweep = 0;
  let truckLive = true;
  let blocked: BlockReason | null = null;
  let blockedAt: number | null = null;
  record(q, true);

  while (travelled < distance - 1e-9) {
    const h = Math.min(PREDICT_STEP, distance - travelled);
    const gap = target - delta;
    const reached = Math.abs(gap) <= ramp * h;
    const eased = reached ? target : delta + Math.sign(gap) * ramp * h;
    // the mean angle over the step: a ramp that ends mid-step only averages over its own share
    const through =
      reached && ramp > 0 ? target - (gap * Math.abs(gap)) / (2 * ramp * h) : (delta + eased) / 2;
    const next = rk4(params, q, direction, through, h);
    const reason = rejection(next);
    if (reason !== null) {
      blocked = reason;
      let [lo, hi] = [0, h];
      for (let i = 0; i < BISECTIONS; i++) {
        const mid = (lo + hi) / 2;
        if (rejection(rk4(params, q, direction, through, mid)) === null) lo = mid;
        else hi = mid;
      }
      blockedAt = travelled + lo;
      if (lo >= MIN_PARTIAL) {
        q = rk4(params, q, direction, through, lo);
        record(q, truckLive);
      }
      break;
    }
    sweep += Math.abs(wrapAngle(next.th0 - q.th0));
    q = next;
    delta = eased;
    travelled += h;
    record(q, truckLive);
    if (sweep >= PREDICT_SWEEP) truckLive = false;
  }

  return {
    trailer,
    truckOuter,
    truckInner,
    blocked,
    blockedAt,
    end: blocked === null ? null : { truck: truckLive ? q.th0 : null, trailer: q.th2 },
  };
}

/** First warning stage: the held steer leads into a contact within `CONTACT_WARN_DISTANCE`. */
export const contactAhead = (p: Prediction): boolean =>
  p.blocked === 'contact' && p.blockedAt !== null && p.blockedAt < CONTACT_WARN_DISTANCE;
