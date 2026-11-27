import type {
  ContactQuery,
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

/** The parked drawbar and body as the truck's obstacles; a touch names the trailer's part, against `self`. */
export function parkedContacts(p: VehicleParams, j: Joints): ContactQuery {
  const parts = bodyFootprints(p, { ...j, coupling: eyeOf(p, j.dolly) }).filter(
    (b) => b.body !== 'truck',
  );
  return (bodies) => {
    for (const { body, obb } of bodies) {
      if (body !== 'truck') continue;
      for (const part of parts) {
        if (obbOverlap(obb, part.obb)) {
          const hit: SimContact = {
            body: part.body,
            obstacleId: SELF_OBSTACLE_ID,
            point: contactPoint(obb, part.obb),
          };
          return hit;
        }
      }
    }
    return null;
  };
}

/** What drives now: uncoupled, the truck alone, with its parked trailer among the obstacles. */
export function drivenRig(
  params: RigParams,
  s: SimSnapshot,
  contacts: ContactQuery,
): { readonly params: RigParams; readonly contacts: ContactQuery } {
  if (s.hitch?.coupled !== false || !hasTrailer(params)) return { params, contacts };
  const parked = parkedContacts(params, s);
  return { params: truckOnly(params), contacts: (bodies) => contacts(bodies) ?? parked(bodies) };
}
