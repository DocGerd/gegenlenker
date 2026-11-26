import type {
  BlockReason,
  BodyFootprint,
  ContactQuery,
  Prediction,
  SimSnapshot,
  Vec2,
} from '../contracts/sim';
import type { VehicleParams } from '../contracts/vehicle';
import { CONTACT_WARN_DISTANCE, PREDICT_DISTANCE, PREDICT_STEP } from './constants';
import { bodyFootprints } from './geometry';
import { joints, pivotViolation, rk4, type KinematicState } from './kinematics';

export const NO_PREDICTION: Prediction = {
  lead: null,
  left: [],
  right: [],
  blocked: null,
  blockedAt: null,
};

const BISECTIONS = 6;
const MIN_PARTIAL = 0.03; // a shorter last piece is dropped, so a blocked start keeps a single point

type Held = {
  readonly direction: 1 | -1;
  readonly target: number;
  /** Road-wheel change per metre: the rate the wheels turn at the current speed. */
  readonly ramp: number;
  readonly q: KinematicState;
  readonly delta: number;
};

/** The held target steer from `from`; null outside D and R. */
function hold(params: VehicleParams, from: SimSnapshot): Held | null {
  const { gear, steer } = from.control;
  if (gear !== 'D' && gear !== 'R') return null;
  const target = Math.min(1, Math.max(-1, steer)) * params.maxRoadWheelAngle;
  const speed = Math.abs(from.speed);
  return {
    direction: gear === 'D' ? 1 : -1,
    target,
    ramp: speed > 0 ? (params.steerRate * params.maxRoadWheelAngle) / speed : 0,
    q: {
      x: from.truck.x,
      y: from.truck.y,
      th0: from.truck.heading,
      th1: from.dolly.heading,
      th2: from.trailer.heading,
    },
    delta: speed > 0 ? from.roadWheelAngle : target,
  };
}

/** The wheel angle after `h` metres eased toward the target, and the mean angle over them. */
function ease(
  delta: number,
  { target, ramp }: Held,
  h: number,
): { eased: number; through: number } {
  const gap = target - delta;
  const reached = Math.abs(gap) <= ramp * h;
  const eased = reached ? target : delta + Math.sign(gap) * ramp * h;
  // the mean angle over the step: a ramp that ends mid-step only averages over its own share
  const through =
    reached && ramp > 0 ? target - (gap * Math.abs(gap)) / (2 * ramp * h) : (delta + eased) / 2;
  return { eased, through };
}

/**
 * The paths of the two corners of the leading end with the target steer held: the trailer's rear
 * when reversing, the truck's front when driving forward. Unit speed makes time steps arc-length
 * steps; the road wheels ramp toward the target along the arc at the rate they would at the current
 * speed, and reach it at once from standstill.
 */
export function predictCombination(
  params: VehicleParams,
  from: SimSnapshot,
  contacts: ContactQuery,
  distance = PREDICT_DISTANCE,
): Prediction {
  const held = hold(params, from);
  if (held === null) return NO_PREDICTION;
  const { direction } = held;
  const lead = direction === 1 ? 'truck' : 'trailer';

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

  const left: Vec2[] = [];
  const right: Vec2[] = [];
  const record = (q: KinematicState): void => {
    const body = footprints(q).find((b) => b.body === lead)?.obb;
    if (body === undefined) throw new Error(`no ${lead} footprint`);
    const [ux, uy] = [Math.cos(body.heading), Math.sin(body.heading)];
    const end = direction * body.halfLength;
    for (const [line, side] of [
      [left, 1],
      [right, -1],
    ] as const) {
      line.push({
        x: body.cx + end * ux - side * body.halfWidth * uy,
        y: body.cy + end * uy + side * body.halfWidth * ux,
      });
    }
  };

  let { q, delta } = held;
  let travelled = 0;
  let blocked: BlockReason | null = null;
  let blockedAt: number | null = null;
  record(q);

  while (travelled < distance - 1e-9) {
    const h = Math.min(PREDICT_STEP, distance - travelled);
    const { eased, through } = ease(delta, held, h);
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
        record(q);
      }
      break;
    }
    q = next;
    delta = eased;
    travelled += h;
    record(q);
  }

  if (left.length !== right.length) throw new Error('corridor lines differ in length');
  return { lead, left, right, blocked, blockedAt };
}

/**
 * Every body's footprint along the path `predictCombination` integrates, from `from` and then every
 * `PREDICT_STEP` up to `distance`, ending early at a pivot limit; empty outside D and R.
 */
export function sweptBodies(
  params: VehicleParams,
  from: SimSnapshot,
  distance: number,
): BodyFootprint[] {
  const held = hold(params, from);
  if (held === null) return [];
  let { q, delta } = held;
  const swept = bodyFootprints(params, joints(params, q));
  for (let travelled = 0; travelled < distance - 1e-9; ) {
    const h = Math.min(PREDICT_STEP, distance - travelled);
    const { eased, through } = ease(delta, held, h);
    const next = rk4(params, q, held.direction, through, h);
    if (pivotViolation(params, next) !== null) break;
    q = next;
    delta = eased;
    travelled += h;
    swept.push(...bodyFootprints(params, joints(params, q)));
  }
  return swept;
}

/** What the held steer runs into within `CONTACT_WARN_DISTANCE`: the first warning stage. */
export type Ahead = 'contact' | 'limit' | null;

export const warnAhead = (p: Prediction): Ahead => {
  if (p.blocked === null || p.blockedAt === null || p.blockedAt >= CONTACT_WARN_DISTANCE) {
    return null;
  }
  return p.blocked === 'contact' ? 'contact' : 'limit';
};

export const contactAhead = (p: Prediction): boolean => warnAhead(p) === 'contact';
