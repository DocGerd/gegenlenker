import type {
  BodyFootprint,
  ContactQuery,
  JawCatch,
  ParkedTrailer,
  Pose2,
  SimContact,
  SimSnapshot,
  Vec2,
} from '../contracts/sim';
import {
  hasTrailer,
  type RigParams,
  type TruckParams,
  type VehicleParams,
} from '../contracts/vehicle';
import { wrapAngle } from './angle';
import { contactPoint, obbOverlap, SELF_OBSTACLE_ID } from './collision';
import { bodyFootprints } from './geometry';
import { joints, type Joints, type KinematicState } from './kinematics';

const toward = (from: Vec2, length: number, heading: number): Vec2 => ({
  x: from.x + length * Math.cos(heading),
  y: from.y + length * Math.sin(heading),
});

/** The truck's share of a combination: what drives while its trailer stands parked. */
export const truckOnly = ({
  wheelbase,
  couplingOffset,
  maxRoadWheelAngle,
  steerRate,
  frontTrack,
  truckFront,
  truckRear,
  truckWidth,
}: TruckParams): TruckParams => ({
  wheelbase,
  couplingOffset,
  maxRoadWheelAngle,
  steerRate,
  frontTrack,
  truckFront,
  truckRear,
  truckWidth,
});

/** The turntable centre of a trailer parked as `t`. */
export const parkedDolly = (p: VehicleParams, t: ParkedTrailer): Vec2 =>
  toward(t.eye, -p.drawbar, t.heading);

export const eyeOf = (p: VehicleParams, dolly: Pose2): Vec2 =>
  toward(dolly, p.drawbar, dolly.heading);

/** The truck from `q`; the trailer stands with its turntable at `dolly`, at the headings `q.th1` and `q.th2`. */
export function parkedJoints(p: VehicleParams, q: KinematicState, dolly: Vec2): Joints {
  const { truck, coupling } = joints(truckOnly(p), q);
  const trailer = toward(dolly, -p.trailerWheelbase, q.th2);
  return {
    truck,
    coupling,
    dolly: { ...dolly, heading: q.th1 },
    trailer: { ...trailer, heading: q.th2 },
    trailerRear: toward(trailer, -p.trailerRearOverhang, q.th2),
  };
}

/** The jaw against the eye in the drawbar's frame: `along` toward the truck, `lateral` to the left. */
export function jawOffset(
  jaw: Vec2,
  eye: Vec2,
  heading: number,
): { along: number; lateral: number } {
  const dx = jaw.x - eye.x;
  const dy = jaw.y - eye.y;
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  return { along: dx * c + dy * s, lateral: -dx * s + dy * c };
}

/**
 * The parked drawbar and body as obstacles to the truck standing as `from`; a touch names the trailer's
 * part, against `self`. Uncoupled at an angle, the frame end stands over the drawbar and drives off: the
 * drawbar counts once the truck is clear of it, which it can then never re-enter.
 */
export function parkedContacts(
  p: VehicleParams,
  j: Joints,
): (from: readonly BodyFootprint[]) => ContactQuery {
  const parts = bodyFootprints(p, { ...j, coupling: eyeOf(p, j.dolly) }).filter(
    (b) => b.body !== 'truck',
  );
  const body = parts.filter((b) => b.body !== 'drawbar');
  const drawbar = parts.filter((b) => b.body === 'drawbar');
  const touch = (
    bodies: readonly BodyFootprint[],
    among: readonly BodyFootprint[],
  ): SimContact | null => {
    for (const { body, obb } of bodies) {
      if (body !== 'truck') continue;
      for (const part of among) {
        if (obbOverlap(obb, part.obb)) {
          return {
            body: part.body,
            obstacleId: SELF_OBSTACLE_ID,
            point: contactPoint(obb, part.obb),
          };
        }
      }
    }
    return null;
  };
  return (from) => {
    const among = touch(from, drawbar) === null ? parts : body;
    return (bodies) => touch(bodies, among);
  };
}

/** The bodies as drawn: uncoupled, the parked drawbar runs from its eye, not from the truck's jaw. */
export const drawnFootprints = (params: RigParams, s: SimSnapshot): BodyFootprint[] =>
  bodyFootprints(params, s.hitch?.coupled === false ? { ...s, coupling: s.hitch.eye } : s);

/**
 * What drives now: uncoupled, the truck alone, with its parked trailer among the obstacles. Reversing
 * lined up inside the `jaw` catch, the path ends at the eye, where the coupling closes: `reach` m on.
 */
export function drivenRig(
  params: RigParams,
  s: SimSnapshot,
  contacts: ContactQuery,
  jaw?: JawCatch,
): { readonly params: RigParams; readonly contacts: ContactQuery; readonly reach: number } {
  if (s.hitch?.coupled !== false || !hasTrailer(params))
    return { params, contacts, reach: Infinity };
  const parked = parkedContacts(params, s)(bodyFootprints(truckOnly(params), s));
  const { along, lateral } = jawOffset(s.coupling, s.hitch.eye, s.dolly.heading);
  const lined =
    jaw !== undefined &&
    s.control.gear === 'R' &&
    along >= 0 &&
    Math.abs(lateral) <= jaw.width &&
    Math.abs(wrapAngle(s.truck.heading - s.dolly.heading)) <= jaw.angle;
  return {
    params: truckOnly(params),
    contacts: (bodies) => contacts(bodies) ?? parked(bodies),
    reach: lined ? along : Infinity,
  };
}
