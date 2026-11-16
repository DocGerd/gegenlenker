import type { BlockReason, Pose2, Vec2 } from '../contracts/sim';
import type { VehicleParams } from '../contracts/vehicle';
import { wrapAngle } from './angle';

/** Truck rear-axle centre and the truck, dolly and trailer headings. */
export type KinematicState = {
  readonly x: number;
  readonly y: number;
  readonly th0: number;
  readonly th1: number;
  readonly th2: number;
};

export type Joints = {
  readonly truck: Pose2;
  readonly coupling: Vec2;
  readonly dolly: Pose2;
  readonly trailer: Pose2;
  readonly trailerRear: Vec2;
};

function derivative(p: VehicleParams, q: KinematicState, v: number, delta: number): KinematicState {
  const w0 = (v * Math.tan(delta)) / p.wheelbase;
  const phi1 = q.th0 - q.th1;
  const w1 = (v * Math.sin(phi1) - p.couplingOffset * w0 * Math.cos(phi1)) / p.drawbar;
  const v1 = v * Math.cos(phi1) + p.couplingOffset * w0 * Math.sin(phi1);
  const w2 = (v1 * Math.sin(q.th1 - q.th2)) / p.trailerWheelbase;
  return { x: v * Math.cos(q.th0), y: v * Math.sin(q.th0), th0: w0, th1: w1, th2: w2 };
}

const add = (q: KinematicState, k: KinematicState, h: number): KinematicState => ({
  x: q.x + h * k.x,
  y: q.y + h * k.y,
  th0: q.th0 + h * k.th0,
  th1: q.th1 + h * k.th1,
  th2: q.th2 + h * k.th2,
});

/** Classical RK4 over `h` with speed `v` and road-wheel angle `delta` held. */
export function rk4(
  p: VehicleParams,
  q: KinematicState,
  v: number,
  delta: number,
  h: number,
): KinematicState {
  const k1 = derivative(p, q, v, delta);
  const k2 = derivative(p, add(q, k1, h / 2), v, delta);
  const k3 = derivative(p, add(q, k2, h / 2), v, delta);
  const k4 = derivative(p, add(q, k3, h), v, delta);
  const mix = (a: number, b: number, c: number, d: number): number =>
    (h / 6) * (a + 2 * b + 2 * c + d);
  return {
    x: q.x + mix(k1.x, k2.x, k3.x, k4.x),
    y: q.y + mix(k1.y, k2.y, k3.y, k4.y),
    th0: wrapAngle(q.th0 + mix(k1.th0, k2.th0, k3.th0, k4.th0)),
    th1: wrapAngle(q.th1 + mix(k1.th1, k2.th1, k3.th1, k4.th1)),
    th2: wrapAngle(q.th2 + mix(k1.th2, k2.th2, k3.th2, k4.th2)),
  };
}

export const couplingAngle = (q: KinematicState): number => wrapAngle(q.th0 - q.th1);
export const turntableAngle = (q: KinematicState): number => wrapAngle(q.th1 - q.th2);

export function pivotViolation(p: VehicleParams, q: KinematicState): BlockReason | null {
  if (Math.abs(couplingAngle(q)) > p.couplingLimit) return 'coupling';
  if (Math.abs(turntableAngle(q)) > p.turntableLimit) return 'turntable';
  return null;
}

/** Positions are derived from the state, so the joints hold by construction. */
export function joints(p: VehicleParams, q: KinematicState): Joints {
  const back = (from: Vec2, length: number, heading: number): Vec2 => ({
    x: from.x - length * Math.cos(heading),
    y: from.y - length * Math.sin(heading),
  });
  const coupling = back(q, p.couplingOffset, q.th0);
  const dolly = back(coupling, p.drawbar, q.th1);
  const trailer = back(dolly, p.trailerWheelbase, q.th2);
  return {
    truck: { x: q.x, y: q.y, heading: q.th0 },
    coupling,
    dolly: { ...dolly, heading: q.th1 },
    trailer: { ...trailer, heading: q.th2 },
    trailerRear: back(trailer, p.trailerRearOverhang, q.th2),
  };
}
