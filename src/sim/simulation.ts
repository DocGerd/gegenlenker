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

function nextSpeed(v: number, control: ControlVector): number {
  const braking = control.brake || control.gear === 'P';
  const direction = control.gear === 'D' ? 1 : control.gear === 'R' ? -1 : 0;
  const vt = braking ? 0 : direction * control.lever * V_MAX;
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
      speed = nextSpeed(speed, control);
      if (speed !== 0) {
        const next = rk4(params, q, speed, steer * params.maxRoadWheelAngle, DT);
        const reason = rejection(next);
        if (reason !== null) {
          speed = 0;
          if (reason !== blocked) {
            if (reason === 'contact') contactCount += 1;
            else jackknifes += 1;
          }
          blocked = reason;
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
