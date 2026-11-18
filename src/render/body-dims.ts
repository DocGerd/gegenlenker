import type { TruckSpec } from '../contracts/vehicle';
import { truckAnchors } from '../vehicles/anchors';
import { CAB_LENGTH, FRAME_TOP, hex, metres, RELIEF, round, TRUCK_WHEEL_RADIUS } from './cab-dims';
import { type TruckLook, TRUCK_LOOKS } from './livery';
import { REALISM_HUES } from './realism-hues';

// No `three` import: scripts/glb-params.mjs loads this module under plain Node.

export const TRUCK_WHEEL_WIDTH = 0.3;
export const TWIN_WHEEL_WIDTH = 0.26;
export const TWIN_OFFSET = 0.15;
export const CAB_GAP = 0.1; // cab rear to body front
export const FLOOR_THICKNESS = 0.2;
export const WALL_THICKNESS = 0.1;
export const TIPPER_WALL_TOP = 2.5;
export const RAIL_HALF_GAP = 0.45; // lateral centre of each chassis rail
export const RAIL_WIDTH = 0.2;
export const MARKER_HEIGHT = 0.1; // side marker lamps; the yellow strip is thinner

export const FLOOR_TOP = FRAME_TOP + FLOOR_THICKNESS;

/** Body front in the top-down view, behind the 2.2 m cab box. */
export const bodyFrontX = (frontX: number, cabLength = CAB_LENGTH): number =>
  frontX - cabLength - CAB_GAP;

/** Height range the procedural side marking and marker lamps occupy along the body sides. */
export function markingBand(): { zLow: number; zHigh: number } {
  const mid = FRAME_TOP + (FLOOR_TOP - FRAME_TOP) / 2;
  return { zLow: round(mid - MARKER_HEIGHT / 2), zHigh: round(mid + MARKER_HEIGHT / 2) };
}

/** Inputs of `tools/blender/body_shell.py`, in the sim body frame: metres, +X forward, +Y left, +Z up. */
export function bodyShellParams(spec: TruckSpec, look: TruckLook = TRUCK_LOOKS[spec.id]) {
  const anchors = truckAnchors(spec);
  return {
    id: spec.id,
    schema: 2,
    kind: look.body.kind,
    width: metres(spec.width),
    rearX: round(anchors.rearX),
    bodyFront: round(bodyFrontX(anchors.frontX, look.cab.length)),
    frameTop: FRAME_TOP,
    floorTop: round(FLOOR_TOP),
    wallThickness: WALL_THICKNESS,
    wallTop: TIPPER_WALL_TOP,
    relief: RELIEF,
    rearAxleX: round(anchors.rearAxle.x),
    wheelRadius: TRUCK_WHEEL_RADIUS,
    marking: markingBand(),
    hues: {
      body: hex(REALISM_HUES.thwBlue),
      white: hex(REALISM_HUES.liveryWhite),
    },
  };
}
