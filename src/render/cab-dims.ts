import type { Param, TruckSpec } from '../contracts/vehicle';
import { truckAnchors } from '../vehicles/anchors';
import { REALISM_HUES } from './realism-hues';

// No `three` import: scripts/cab-params.mjs loads this module under plain Node.

export const CAB_LENGTH = 2.2;
export const CAB_HEIGHT = 2.9;
export const FRAME_TOP = 1.1; // chassis top and floor of cab and body
export const RAIL_BOTTOM = 0.65;
export const RELIEF = 0.03; // marks and lamps on a body face
export const PLATE_RELIEF = 0.06; // plate stands this far ahead of the bumper face

const round = (value: number): number => Math.round(value * 1e6) / 1e6;
const metres = (param: Param): number => round(param.value / 1000);
const hex = (rgb: number): string => `#${rgb.toString(16).padStart(6, '0')}`;

/** Inputs of `tools/blender/cab_shell.py`, in the sim body frame: metres, +X forward, +Y left, +Z up. */
export function cabShellParams(spec: TruckSpec) {
  const { cab } = spec;
  return {
    id: spec.id,
    width: metres(spec.width),
    frontX: round(truckAnchors(spec).frontX),
    cabLength: CAB_LENGTH,
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
      headlampInset: metres(cab.headlampInset),
      headlampWidth: metres(cab.headlampWidth),
      lampSill: metres(cab.lampSill),
      lampHeight: metres(cab.lampHeight),
    },
    hues: {
      glass: hex(REALISM_HUES.anthracite),
      grille: hex(REALISM_HUES.chevronBlack),
      lamp: hex(REALISM_HUES.plateWhite),
      bumper: hex(REALISM_HUES.anthracite),
    },
  };
}
