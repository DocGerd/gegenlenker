import type {
  BlockReason,
  BodyFootprint,
  ContactQuery,
  ControlVector,
  SimContact,
  Simulation,
  SimSnapshot,
  StartState,
  Vec2,
} from '../contracts/sim';
import { hasTrailer, type RigParams } from '../contracts/vehicle';
import { wrapAngle } from './angle';
import { ACCEL, BRAKE_DECEL, DECEL, DT, EVENT_CLEAR_DISTANCE, V_MAX } from './constants';
import { SELF_OBSTACLE_ID } from './collision';
import { bodyFootprints } from './geometry';
import { eyeOf, jawOffset, parkedContacts, parkedDolly, parkedJoints, truckOnly } from './hitch';
import {
  couplingAngle,
  joints,
  pivotViolation,
  rk4,
  turntableAngle,
  type Joints,
  type KinematicState,
} from './kinematics';

const NEUTRAL: ControlVector = { steer: 0, lever: 0, brake: false, gear: 'P' };

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

function approach(current: number, target: number, maxDelta: number): number {
  const next =
    Math.abs(target - current) <= maxDelta
      ? target
      : current + Math.sign(target - current) * maxDelta;
  return next === 0 ? 0 : next; // no −0 in snapshots
}

const isBraking = (control: ControlVector): boolean => control.brake || control.gear === 'P';

function targetSpeed(control: ControlVector): number {
  const direction = control.gear === 'D' ? 1 : control.gear === 'R' ? -1 : 0;
  return isBraking(control) ? 0 : direction * control.lever * V_MAX;
}

function nextSpeed(v: number, control: ControlVector): number {
  const braking = isBraking(control);
  const vt = targetSpeed(control);
  const rate = braking
    ? BRAKE_DECEL
    : Math.abs(vt) > Math.abs(v) && (v === 0 || Math.sign(v) === Math.sign(vt))
      ? ACCEL
      : DECEL;
  return approach(v, vt, rate * DT);
}

function easesPivot(reason: BlockReason, next: KinematicState, q: KinematicState): boolean {
  if (reason === 'contact') return true;
  const angle = reason === 'coupling' ? couplingAngle : turntableAngle;
  return Math.abs(angle(next)) < Math.abs(angle(q));
}

export function createSimulation(
  params: RigParams,
  start: StartState,
  contacts: ContactQuery,
): Simulation {
  const th0 = wrapAngle(start.truck.heading);
  // solo: no trailer to bend, and its headings stay the truck's
  const solo = !hasTrailer(params);
  const th1 = solo ? th0 : wrapAngle(th0 - (start.couplingAngle ?? 0));
  let q: KinematicState = {
    x: start.truck.x,
    y: start.truck.y,
    th0,
    th1,
    th2: solo ? th0 : wrapAngle(th1 - (start.turntableAngle ?? 0)),
  };
  const hitch =
    hasTrailer(params) && start.parked !== undefined
      ? { params, truck: truckOnly(params), ...start.parked }
      : null;
  /** While uncoupled, where the parked trailer's turntable stands, and the truck's contacts with it (`parkedContacts`). */
  let parked: {
    readonly dolly: Vec2;
    readonly contacts: (from: readonly BodyFootprint[]) => ContactQuery;
  } | null = null;
  let couplingSpeed: number | null = null;
  if (hitch !== null) {
    const { heading, turntable } = hitch.trailer;
    q = { ...q, th1: wrapAngle(heading), th2: wrapAngle(heading - turntable) };
    const dolly = parkedDolly(hitch.params, hitch.trailer);
    parked = {
      dolly,
      contacts: parkedContacts(hitch.params, parkedJoints(hitch.params, q, dolly)),
    };
  }

  // Uncoupled, the truck drives alone and the trailer's headings stand still.
  const integrate = (from: KinematicState, v: number, delta: number): KinematicState =>
    hitch === null || parked === null
      ? rk4(params, from, v, delta, DT)
      : { ...rk4(hitch.truck, from, v, delta, DT), th1: from.th1, th2: from.th2 };
  const jointsOf = (state: KinematicState): Joints =>
    hitch === null || parked === null
      ? joints(params, state)
      : parkedJoints(hitch.params, state, parked.dolly);
  let control = NEUTRAL;
  let steer = 0;
  let speed = 0;
  let blocked: BlockReason | null = null;
  let blockedSign = 0;
  let blockedContact: SimContact | null = null;
  let contactCount = 0;
  let jackknifes = 0;
  let directionChanges = 0;
  let lastSign = 0;
  let step = 0;

  // Events are counted per incident: a key counts once until the vehicle travels clear.
  const incident = new Set<string>();
  let travelledSinceRejection = 0;

  /** Coupled, the whole combination; uncoupled, the truck alone against the obstacles and the parked trailer. */
  const rejection = (
    next: KinematicState,
    coupled = parked === null,
  ): { reason: BlockReason; key: string; contact?: SimContact } | null => {
    let hit: SimContact | null;
    if (coupled || hitch === null || parked === null) {
      const pivot = pivotViolation(params, next);
      if (pivot !== null) {
        const angle = pivot === 'coupling' ? couplingAngle(next) : turntableAngle(next);
        return { reason: pivot, key: `${pivot}:${Math.sign(angle)}` };
      }
      hit = contacts(bodyFootprints(params, joints(params, next)));
    } else {
      const bodies = bodyFootprints(hitch.truck, jointsOf(next));
      hit = contacts(bodies) ?? parked.contacts(bodyFootprints(hitch.truck, jointsOf(q)))(bodies);
    }
    return hit === null
      ? null
      : { reason: 'contact', key: `contact:${hit.body}:${hit.obstacleId}`, contact: hit };
  };

  /**
   * Coupled as `next` brings the jaw onto the eye, within the catch: the drawbar swings about the
   * turntable onto the jaw, the truck and the trailer's heading stay, and the turntable moves at most one
   * step's travel along the drawbar. Null where it does not catch, or the coupled rig would be rejected.
   */
  const caught = (next: KinematicState): KinematicState | null => {
    if (hitch === null || parked === null) return null;
    const { dolly } = parked;
    const j = parkedJoints(hitch.params, next, dolly);
    const { along, lateral } = jawOffset(j.coupling, eyeOf(hitch.params, j.dolly), next.th1);
    if (along > 0 || along < -V_MAX * DT || Math.abs(lateral) > hitch.jaw.width) return null;
    if (Math.abs(wrapAngle(next.th0 - next.th1)) > hitch.jaw.angle) return null;
    const joined = { ...next, th1: Math.atan2(j.coupling.y - dolly.y, j.coupling.x - dolly.x) };
    return rejection(joined, true) === null ? joined : null;
  };

  const snapshot = (): SimSnapshot => {
    const at = jointsOf(q);
    return {
      step,
      time: step * DT,
      ...at,
      couplingAngle: couplingAngle(q),
      turntableAngle: turntableAngle(q),
      steer,
      roadWheelAngle: steer * params.maxRoadWheelAngle,
      speed,
      control,
      blocked,
      contact:
        blocked === 'contact' && blockedContact !== null
          ? {
              body: blockedContact.body,
              point: blockedContact.point,
              self: blockedContact.obstacleId === SELF_OBSTACLE_ID,
            }
          : null,
      contacts: contactCount,
      jackknifes,
      directionChanges,
      ...(hitch === null
        ? {}
        : {
            hitch: {
              coupled: parked === null,
              eye: parked === null ? at.coupling : eyeOf(hitch.params, at.dolly),
              couplingSpeed,
            },
          }),
    };
  };

  return {
    snapshot,
    step(input) {
      control = {
        steer: clamp(input.steer, -1, 1),
        lever: clamp(input.lever, 0, 1),
        brake: input.brake,
        gear: input.gear,
        ...(input.uncouple === true ? { uncouple: true as const } : {}),
      };
      if (control.uncouple === true && hitch !== null && parked === null && speed === 0) {
        const j = joints(hitch.params, q);
        parked = {
          dolly: { x: j.dolly.x, y: j.dolly.y },
          contacts: parkedContacts(hitch.params, j),
        };
      }
      steer = approach(steer, control.steer, params.steerRate * DT);
      const delta = steer * params.maxRoadWheelAngle;
      let held = false;
      if (blocked !== null && Math.sign(targetSpeed(control)) === blockedSign) {
        // A step ramping up from standstill is small enough to creep into the margin the rejected
        // step left and re-trigger, so the block lifts only when a full-speed step is valid and,
        // at a pivot, also eases the fold rather than merely slowing it.
        const probe = integrate(q, blockedSign * V_MAX, delta);
        held = rejection(probe) !== null || !easesPivot(blocked, probe, q);
        if (!held) blocked = null;
      }
      if (!held) speed = nextSpeed(speed, control);
      if (!held && speed !== 0) {
        const moved = integrate(q, speed, delta);
        const joined = speed < 0 ? caught(moved) : null;
        const next = joined ?? moved;
        const rejected = joined === null ? rejection(next) : null;
        if (rejected !== null) {
          if (!incident.has(rejected.key)) {
            incident.add(rejected.key);
            if (rejected.reason === 'contact') contactCount += 1;
            else jackknifes += 1;
          }
          travelledSinceRejection = 0;
          blocked = rejected.reason;
          blockedContact = rejected.contact ?? null;
          blockedSign = Math.sign(speed);
          speed = 0;
        } else {
          q = next;
          blocked = null;
          travelledSinceRejection += Math.abs(speed) * DT;
          if (travelledSinceRejection >= EVENT_CLEAR_DISTANCE) incident.clear();
          const sign = Math.sign(speed);
          if (lastSign !== 0 && sign !== lastSign) directionChanges += 1;
          lastSign = sign;
          if (joined !== null) {
            // the jaw closes on the braked trailer, which stops the truck
            parked = null;
            couplingSpeed = Math.max(couplingSpeed ?? 0, Math.abs(speed));
            speed = 0;
          }
        }
      }
      step += 1;
      return snapshot();
    },
  };
}
