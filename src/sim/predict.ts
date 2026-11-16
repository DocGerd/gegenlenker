import type { SimSnapshot, Vec2 } from '../contracts/sim';
import type { VehicleParams } from '../contracts/vehicle';
import { PREDICT_STEP } from './constants';
import { joints, pivotViolation, rk4 } from './kinematics';

/** Trailer rear-end path with the current road-wheel angle held; unit speed makes time steps arc-length steps. */
export function predictTrailerRear(
  params: VehicleParams,
  from: SimSnapshot,
  direction: 1 | -1,
  distance: number,
): Vec2[] {
  let q = {
    x: from.truck.x,
    y: from.truck.y,
    th0: from.truck.heading,
    th1: from.dolly.heading,
    th2: from.trailer.heading,
  };
  const path = [from.trailerRear];
  const steps = Math.ceil(distance / PREDICT_STEP - 1e-9);
  for (let i = 0; i < steps; i++) {
    const h = Math.min(PREDICT_STEP, distance - i * PREDICT_STEP);
    const next = rk4(params, q, direction, from.roadWheelAngle, h);
    if (pivotViolation(params, next) !== null) break;
    q = next;
    path.push(joints(params, q).trailerRear);
  }
  return path;
}
