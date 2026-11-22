import type { Vec2 } from '../contracts/sim';
import type { TruckSpec, Vec3 } from '../contracts/vehicle';
import { truckAnchors } from '../vehicles/anchors';
import { CAB_HEIGHT, cabShellParams } from './cab-dims';

// No `three` import: the fields are ground polygons in the truck body frame (x forward, y left).

/** UN R46 15.2.4.6.1: the class VI field reaches this far (m) ahead of the bumper and past the passenger side. */
export const CLASS_VI_REACH = 2;
const ARC_STEPS = 16;

/**
 * The ground the class VI mirror must show: from the bumper plane to
 * `CLASS_VI_REACH` ahead, from the driver-side plane to `CLASS_VI_REACH` beyond the passenger side,
 * its far corner rounded with radius `CLASS_VI_REACH`.
 */
export function classVIField(truck: TruckSpec): readonly Vec2[] {
  const { frontX, width } = cabShellParams(truck);
  const half = width / 2;
  const far = frontX + CLASS_VI_REACH;
  const polygon: Vec2[] = [
    { x: frontX, y: half },
    { x: far, y: half },
  ];
  // the arc is centred on the bumper's passenger corner
  for (let i = 0; i <= ARC_STEPS; i++) {
    const angle = -(Math.PI / 2) * (i / ARC_STEPS);
    polygon.push({
      x: frontX + CLASS_VI_REACH * Math.cos(angle),
      y: -half + CLASS_VI_REACH * Math.sin(angle),
    });
  }
  return polygon;
}

/** UN R46 15.2.4.4.1/.2: class IV shows a strip this wide (m) beside the vehicle, from `CLASS_IV_NEAR` to `CLASS_IV_FAR` behind the ocular points. */
export const CLASS_IV_WIDTH = 15;
export const CLASS_IV_NEAR = 10;
export const CLASS_IV_FAR = 25;
/** ... and, from `CLASS_IV_START` behind the ocular plane, a strip `CLASS_IV_NARROW` wide. */
export const CLASS_IV_START = 1.5;
export const CLASS_IV_NARROW = 4.5;

/**
 * The ground a class IV mirror must show on `side`: the narrow strip from `CLASS_IV_START` behind the
 * ocular points, widening to `CLASS_IV_WIDTH` at `CLASS_IV_NEAR`, out to `CLASS_IV_FAR`; the horizon
 * is taken as that far. Both strips start at the outermost side of the cab.
 */
export function classIVField(truck: TruckSpec, side: 'left' | 'right'): readonly Vec2[] {
  const { width } = cabShellParams(truck);
  const { eye } = truckAnchors(truck);
  const sign = side === 'left' ? 1 : -1;
  const half = width / 2;
  const edge = (behind: number, out: number): Vec2 => ({
    x: eye.x - behind,
    y: sign * (half + out),
  });
  return [
    edge(CLASS_IV_START, 0),
    edge(CLASS_IV_START, CLASS_IV_NARROW),
    edge(CLASS_IV_NEAR, CLASS_IV_NARROW),
    edge(CLASS_IV_NEAR, CLASS_IV_WIDTH),
    edge(CLASS_IV_FAR, CLASS_IV_WIDTH),
    edge(CLASS_IV_FAR, 0),
  ];
}

/**
 * UN R46 15.2.4.5: the class V field on the passenger side, reported only: from the cab side to 2 m
 * out, from 1.75 m behind to 1 m ahead of the ocular plane.
 */
export function classVField(truck: TruckSpec): readonly Vec2[] {
  const { width } = cabShellParams(truck);
  const { eye } = truckAnchors(truck);
  const half = width / 2;
  return [
    { x: eye.x + 1, y: -half },
    { x: eye.x + 1, y: -half - 2 },
    { x: eye.x - 1.75, y: -half - 2 },
    { x: eye.x - 1.75, y: -half },
  ];
}

/** Whether `p` lies inside `polygon`, edges included to a rounding error. */
export function insidePolygon(polygon: readonly Vec2[], p: Vec2): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a === undefined || b === undefined) continue;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Metres ahead of the cab front (on a short boom), and inboard of its passenger side, that the class VI mirror sits. */
const FRONT_AHEAD = 0.5;
const FRONT_INBOARD = 0.25;
/** Below the cab's roof: R46 15.2.2.7 keeps class V and VI parts 2 m or more above the ground. */
const FRONT_BELOW_ROOF = 0.1;

/** The class VI mirror's eye in the body frame: top front of the cab, passenger side, ahead of the glass. */
export function frontMirrorMount(truck: TruckSpec): Vec3 {
  const { frontX, width } = cabShellParams(truck);
  return {
    x: frontX + FRONT_AHEAD,
    y: -(width / 2 - FRONT_INBOARD),
    z: CAB_HEIGHT - FRONT_BELOW_ROOF,
  };
}
