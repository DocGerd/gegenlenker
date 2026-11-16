import type {
  BlockReason,
  ContactQuery,
  ControlVector,
  Simulation,
  SimSnapshot,
  StartState,
} from '../contracts/sim';
import type { VehicleParams } from '../contracts/vehicle';
import { wrapAngle } from './angle';
import { ACCEL, BRAKE_DECEL, DECEL, DT, V_MAX } from './constants';
import { bodyFootprints } from './geometry';
import {
  couplingAngle,
  joints,
  pivotViolation,
  rk4,
  turntableAngle,
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

export function createSimulation(
  params: VehicleParams,
  start: StartState,
  contacts: ContactQuery,
): Simulation {
  const th0 = wrapAngle(start.truck.heading);
  const th1 = wrapAngle(th0 - (start.couplingAngle ?? 0));
  let q: KinematicState = {
    x: start.truck.x,
    y: start.truck.y,
    th0,
    th1,
    th2: wrapAngle(th1 - (start.turntableAngle ?? 0)),
  };
  let control = NEUTRAL;
  let steer = 0;
  let speed = 0;
  let blocked: BlockReason | null = null;
  let blockedSign = 0;
  let contactCount = 0;
  let jackknifes = 0;
  let directionChanges = 0;
  let lastSign = 0;
  let step = 0;

  const rejection = (next: KinematicState): BlockReason | null =>
    pivotViolation(params, next) ??
    (contacts(bodyFootprints(params, joints(params, next))) !== null ? 'contact' : null);

  const snapshot = (): SimSnapshot => ({
    step,
    time: step * DT,
    ...joints(params, q),
    couplingAngle: couplingAngle(q),
    turntableAngle: turntableAngle(q),
    steer,
    roadWheelAngle: steer * params.maxRoadWheelAngle,
    speed,
    control,
    blocked,
    contacts: contactCount,
    jackknifes,
    directionChanges,
  });

  return {
    snapshot,
    step(input) {
      control = {
        steer: clamp(input.steer, -1, 1),
        lever: clamp(input.lever, 0, 1),
        brake: input.brake,
        gear: input.gear,
      };
      steer = approach(steer, control.steer, params.steerRate * DT);
      const delta = steer * params.maxRoadWheelAngle;
      let held = false;
      let sameEpisode = false;
      if (blocked !== null && Math.sign(targetSpeed(control)) === blockedSign) {
        // A step ramping up from standstill is small enough to creep into the margin the rejected
        // step left and re-trigger, so the episode ends only when a full-speed step is valid.
        held = rejection(rk4(params, q, blockedSign * V_MAX, delta, DT)) !== null;
        if (!held) {
          blocked = null;
          sameEpisode = true;
        }
      }
      if (!held) speed = nextSpeed(speed, control);
      if (!held && speed !== 0) {
        const next = rk4(params, q, speed, delta, DT);
        const reason = rejection(next);
        if (reason !== null) {
          if (!sameEpisode && reason !== blocked) {
            if (reason === 'contact') contactCount += 1;
            else jackknifes += 1;
          }
          blocked = reason;
          blockedSign = Math.sign(speed);
          speed = 0;
        } else {
          q = next;
          blocked = null;
          const sign = Math.sign(speed);
          if (lastSign !== 0 && sign !== lastSign) directionChanges += 1;
          lastSign = sign;
        }
      }
      step += 1;
      return snapshot();
    },
  };
}
