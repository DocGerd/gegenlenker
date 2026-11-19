import type { Param, TruckSpec } from '../contracts/vehicle';
import { truckAnchors } from '../vehicles/anchors';
import { REALISM_HUES } from './realism-hues';
import { type TruckLook, TRUCK_LOOKS } from './livery';

// No `three` import: scripts/glb-params.mjs loads this module under plain Node.

export const CAB_LENGTH = 2.2; // the top-down cab box; the perspective cab may be longer (livery.ts)
export const CAB_HEIGHT = 2.9;
export const FRAME_TOP = 1.1; // chassis top and floor of cab and body
export const RAIL_BOTTOM = 0.65;
export const RELIEF = 0.03; // marks and lamps on a body face
export const TRUCK_WHEEL_RADIUS = 0.5;
export const PLATE_RELIEF = 0.06; // plate stands this far ahead of the bumper face
/** The cab's white side stripe above the frame top (cab_shell.py STRIPE); the tipper's stripe lines up with it. */
export const CAB_STRIPE = [0.62, 0.76] as const;

export const round = (value: number): number => Math.round(value * 1e6) / 1e6;
export const metres = (param: Param): number => round(param.value / 1000);
export const hex = (rgb: number): string => `#${rgb.toString(16).padStart(6, '0')}`;

/** Inputs of `tools/blender/cab_shell.py`, in the sim body frame: metres, +X forward, +Y left, +Z up. */
export function cabShellParams(spec: TruckSpec, look: TruckLook = TRUCK_LOOKS[spec.id]) {
  const { cab } = spec;
  const anchors = truckAnchors(spec);
  return {
    id: spec.id,
    schema: 3,
    style: look.cab.style,
    width: metres(spec.width),
    frontX: round(anchors.frontX),
    frontAxleX: round(anchors.frontAxle.x),
    wheelRadius: TRUCK_WHEEL_RADIUS,
    cabLength: look.cab.length,
    cabHeight: CAB_HEIGHT,
    frameTop: FRAME_TOP,
    railBottom: RAIL_BOTTOM,
    relief: RELIEF,
    plateRelief: PLATE_RELIEF,
    bumperInset: metres(spec.bumperInset),
    cab: {
      windscreenInset: metres(cab.windscreenInset),
      glassSill: metres(cab.glassSill),
      glassHeight: metres(cab.glassHeight),
      sideGlassSetback: metres(cab.sideGlassSetback),
      sideGlassLength: metres(cab.sideGlassLength),
      grilleWidth: metres(cab.grilleWidth),
      grilleSill: metres(cab.grilleSill),
      grilleHeight: metres(cab.grilleHeight),
    },
    hues: {
      body: hex(REALISM_HUES.thwBlue),
      glass: hex(REALISM_HUES.anthracite),
      grille: hex(REALISM_HUES.chevronBlack),
      white: hex(REALISM_HUES.liveryWhite),
      beacon: hex(REALISM_HUES.beaconBlue),
      black: hex(REALISM_HUES.chevronBlack),
      silver: hex(REALISM_HUES.whiteAluminium),
    },
  };
}
