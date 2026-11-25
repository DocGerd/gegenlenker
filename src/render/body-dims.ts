import type { TruckSpec } from '../contracts/vehicle';
import { truckAnchors } from '../vehicles/anchors';
import {
  CAB_LENGTH,
  CAB_STRIPE,
  FRAME_TOP,
  hex,
  metres,
  RELIEF,
  round,
  TRUCK_WHEEL_RADIUS,
} from './cab-dims';
import { type RearTyres, type TruckLook, TRUCK_LOOKS } from './livery';
import { REALISM_HUES } from './realism-hues';

// No `three` import: scripts/glb-params.mjs loads this module under plain Node.

export const TRUCK_WHEEL_WIDTH = 0.3;
export const TWIN_WHEEL_WIDTH = 0.26;
export const TWIN_OFFSET = 0.15;

/** The perspective rear tyres on each side: lateral offsets from the half track, and their width. */
export type RearTyreSet = { readonly offsets: readonly number[]; readonly width: number };

/** Perspective-only: the top-down wheel tokens and blob shadows always draw the twins. */
export const rearTyreSet = (tyres: RearTyres): RearTyreSet =>
  tyres === 'twin'
    ? { offsets: [-TWIN_OFFSET, TWIN_OFFSET], width: TWIN_WHEEL_WIDTH }
    : { offsets: [0], width: TRUCK_WHEEL_WIDTH };
export const CAB_GAP = 0.1; // cab rear to body front
export const FLOOR_THICKNESS = 0.2;
export const WALL_THICKNESS = 0.1;
export const TIPPER_WALL_TOP = 2.5;
/** The shells' rim on a tipper's headboard and tarpaulin top (tools/blender/body_shell.py RIM, TARP_TOP); `glb-shells.test.ts` checks the glbs against them. */
export const TIPPER_RIM = 0.06;
export const TARP_TOP = 2.75;
export const RAIL_HALF_GAP = 0.45; // lateral centre of each chassis rail
export const RAIL_WIDTH = 0.2;
export const MARKER_HEIGHT = 0.1; // side marker lamps; the yellow strip is thinner
export const CONTOUR_STRIP = 0.06; // contour marking, ECE R48 asks at least 50 mm
export const MARKER_LENGTH = 0.2;
export const MARKER_SPACING = 3; // ECE R48 maximum between side marker lamps
export const MARKING_END_MARGIN = 0.1; // side marking stops short of the body ends

export const FLOOR_TOP = FRAME_TOP + FLOOR_THICKNESS;

/**
 * The tipper shell's low drop sides and taller headboard, above the floor. Perspective-only render
 * estimates: the procedural body and the top-down view keep TIPPER_WALL_TOP.
 */
export const TIPPER_SHELL = { wallHeight: 0.6, headboardHeight: 1.1 } as const;

/**
 * More of what `tools/blender/body_shell.py` builds the rear stalk lamps on, besides `TIPPER_RIM`
 * and `TARP_TOP`: how far a tipper's corner posts stand proud, and the tarpaulin's inset and crown.
 * The script owns the numbers and `body-dims.test.ts` pins them; they are not Params, so they stay
 * out of the glb inputs.
 */
export const BODY_SHELL = { postProud: 0.06, tarpInset: 0.04, tarpCrown: 0.06 } as const;

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
    schema: 5,
    kind: look.body.kind,
    width: metres(spec.width),
    rearX: round(anchors.rearX),
    bodyFront: round(bodyFrontX(anchors.frontX, look.cab.length)),
    frameTop: FRAME_TOP,
    floorTop: round(FLOOR_TOP),
    wallThickness: WALL_THICKNESS,
    relief: RELIEF,
    rearAxleX: round(anchors.rearAxle.x),
    rearTrack: metres(spec.rearTrack),
    rearTyres: rearTyreSet(look.body.rearTyres),
    wheelRadius: TRUCK_WHEEL_RADIUS,
    rail: { halfGap: RAIL_HALF_GAP, width: RAIL_WIDTH },
    marking: { ...markingBand(), endMargin: MARKING_END_MARGIN },
    tailLamp: {
      inset: metres(spec.tailLamp.inset),
      width: metres(spec.tailLamp.width),
      sill: metres(spec.tailLamp.sill),
      height: metres(spec.tailLamp.height),
    },
    ...(look.body.kind === 'tipper'
      ? {
          tipper: {
            wallTop: round(FLOOR_TOP + TIPPER_SHELL.wallHeight),
            headboardTop: round(FLOOR_TOP + TIPPER_SHELL.headboardHeight),
            stripe: CAB_STRIPE.map((z) => round(FRAME_TOP + z)),
          },
        }
      : {}),
    hues: {
      body: hex(REALISM_HUES.thwBlue),
      white: hex(REALISM_HUES.liveryWhite),
      black: hex(REALISM_HUES.chevronBlack),
      silver: hex(REALISM_HUES.whiteAluminium),
      red: hex(REALISM_HUES.contourRear),
    },
  };
}
