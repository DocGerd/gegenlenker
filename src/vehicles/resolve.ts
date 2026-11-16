import type { TrailerSpec, TruckSpec, VehicleParams } from '../contracts/vehicle';

const m = (mm: number): number => mm / 1000;
const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Treats the turning radius as the path of the outer front wheel centre. */
export function maxRoadWheelAngle(truck: TruckSpec): number {
  const R = m(truck.turningRadius.value);
  const L = m(truck.wheelbase.value);
  const Tf = m(truck.frontTrack.value);
  const Rr = Math.sqrt(R * R - L * L) - Tf / 2;
  return Math.atan(L / Rr);
}

export function resolveCombination(truck: TruckSpec, trailer: TrailerSpec): VehicleParams {
  return {
    wheelbase: m(truck.wheelbase.value),
    couplingOffset: m(truck.couplingOffset.value),
    maxRoadWheelAngle: maxRoadWheelAngle(truck),
    steerRate: (2 * truck.steering.maxRate.value) / truck.steering.lockToLockTurns.value,
    frontTrack: m(truck.frontTrack.value),
    truckFront: m(truck.wheelbase.value + truck.frontOverhang.value),
    truckRear: m(truck.rearOverhang.value),
    truckWidth: m(truck.width.value),
    drawbar: m(trailer.drawbar.value),
    trailerWheelbase: m(trailer.wheelbase.value),
    trailerFrontOverhang: m(trailer.frontOverhang.value),
    trailerRearOverhang: m(trailer.rearOverhang.value),
    trailerWidth: m(trailer.width.value),
    couplingLimit: rad(trailer.couplingLimit.value),
    turntableLimit: rad(trailer.turntableLimit.value),
  };
}
