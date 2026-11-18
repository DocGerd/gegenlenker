import { TRUCK_IDS, type TrailerSpec } from '../contracts/vehicle';
import { trailerAnchors, truckAnchors } from '../vehicles/anchors';
import { truckById } from '../vehicles/registry';
import {
  CONTOUR_STRIP,
  MARKER_HEIGHT,
  MARKER_LENGTH,
  MARKER_SPACING,
  MARKING_END_MARGIN,
  RAIL_HALF_GAP,
  RAIL_WIDTH,
} from './body-dims';
import { hex, metres, round, TRUCK_WHEEL_RADIUS } from './cab-dims';
import { TRAILER_LOOKS, type TrailerLook } from './livery';
import { REALISM_HUES } from './realism-hues';

// No `three` import: scripts/glb-params.mjs loads this module under plain Node.

export const TRAILER_WHEEL_WIDTH = 0.3;
export const SWAP_BODY_HEIGHT = 2.7;
export const RAMP_HEIGHT = 1.2;
export const RAMP_WIDTH = 0.9;
export const RAMP_GAP = 0.15; // from the centreline to the inner ramp edge
export const RAMP_THICKNESS = 0.1;
export const DECK_PLATE = 0.1; // low-loader deck slab
export const BOX_FRAME_DEPTH = 0.25; // rails under a swap body
export const WHEEL_CLEARANCE = 0.02;
export const DRAWBAR_SPREAD = 0.45; // arm spacing at the turntable end
export const ARM_WIDTH = 0.12;
export const ARM_HEIGHT = 0.1;
export const PLATE_RADIUS = 0.5;
export const PLATE_THICKNESS = 0.1;
export const POST_HALF_WIDTH = 0.15;
export const AXLE_HALF_THICKNESS = 0.07;
export const SWING_MARGIN = 0.1;
/** The drawbar eye's block, in the dolly frame: reach behind and ahead of the eye, half width and half height. */
export const EYE_BLOCK = { back: 0.15, front: 0.05, halfWidth: 0.1, halfHeight: 0.07 } as const;

/**
 * Dimensions both the procedural trailer and its shell derive from the Params. Body frame: the
 * effective rear axle is the origin. Dolly frame: the turntable centre is the origin.
 */
export function trailerFrame(spec: TrailerSpec) {
  const a = trailerAnchors(spec);
  const hw = spec.width.value / 2000;
  const track = spec.track.value / 1000;
  const deck = spec.deckHeight.value / 1000;
  const isBox = spec.body === 'box';
  // Wheels, axles, plate and drawbar all stay below the deck's underside.
  const underside = deck - (isBox ? BOX_FRAME_DEPTH : DECK_PLATE);
  const radius = Math.min(TRUCK_WHEEL_RADIUS, (underside - WHEEL_CLEARANCE) / 2);
  const axleZ: readonly [number, number] = [
    radius - AXLE_HALF_THICKNESS,
    radius + AXLE_HALF_THICKNESS,
  ];
  const plateTop = underside - WHEEL_CLEARANCE;
  const plateBottom = plateTop - PLATE_THICKNESS;
  const plateMid = (plateTop + plateBottom) / 2;
  // clear of the deck front as the body swings over the arms
  const kink = Math.min(
    Math.hypot(a.frontX - a.turntable.x, hw) + SWING_MARGIN,
    a.eye.x - SWING_MARGIN,
  );
  return {
    a,
    hw,
    track,
    deck,
    isBox,
    underside,
    radius,
    axleZ,
    plateTop,
    plateBottom,
    plateMid,
    kink,
  };
}

/**
 * The low-loader shell's machine deck, and the procedural detail that follows it in perspective.
 * Render estimates, not Params: the procedural deck and the top-down view keep the flat deck.
 */
export const LOW_LOADER = {
  carrierDepth: 0.08, // rear lamp carrier, ahead of rearX
  slopeLength: 0.95, // rear section sloping down to the ramps
  slopeDrop: 0.2,
  frontLength: 1.6, // raised front section over the dolly
  frontRise: 0.15,
  rampAboveEye: 0.1, // folded ramps stand this far above the highest cockpit eye
} as const;

/** Where the low-loader shell's deck breaks, in the trailer body frame. */
export function lowLoaderDeck(spec: TrailerSpec) {
  const { a, deck } = trailerFrame(spec);
  const rearDeck = deck - LOW_LOADER.slopeDrop;
  const lampTop = rearDeck + metres(spec.tailLamp.sill) + metres(spec.tailLamp.height);
  const slopeEnd = a.rearX + LOW_LOADER.carrierDepth + RAMP_THICKNESS; // ramps fold up in between
  const eye = Math.max(...TRUCK_IDS.map((id) => truckAnchors(truckById(id)).eye.z));
  return {
    carrierX: round(a.rearX + LOW_LOADER.carrierDepth),
    slopeEnd: round(slopeEnd),
    slopeStart: round(slopeEnd + LOW_LOADER.slopeLength),
    rearDeck: round(rearDeck),
    contourZ: round(lampTop + CONTOUR_STRIP),
    carrierTop: round(lampTop + 2 * CONTOUR_STRIP),
    frontStart: round(a.frontX - LOW_LOADER.frontLength),
    frontDeck: round(deck + LOW_LOADER.frontRise),
    rampTop: round(eye + LOW_LOADER.rampAboveEye),
  };
}

export type LowLoaderDeck = ReturnType<typeof lowLoaderDeck>;

const HUES = {
  'low-loader': {
    base: hex(REALISM_HUES.thwBlue),
    frame: hex(REALISM_HUES.thwBlueDeep),
    black: hex(REALISM_HUES.chevronBlack),
    silver: hex(REALISM_HUES.whiteAluminium),
  },
  lafette: {
    base: hex(REALISM_HUES.chevronBlack),
    white: hex(REALISM_HUES.liveryWhite),
    silver: hex(REALISM_HUES.whiteAluminium),
    yellow: hex(REALISM_HUES.signalYellow),
    contour: hex(REALISM_HUES.contourSide),
    marker: hex(REALISM_HUES.sideMarker),
  },
} as const;

/** Inputs of `tools/blender/trailer_shell.py`; the first hue is the livery's base colour. */
export function trailerShellParams(spec: TrailerSpec, look: TrailerLook = TRAILER_LOOKS[spec.id]) {
  const f = trailerFrame(spec);
  const { a } = f;
  return {
    id: spec.id,
    schema: 2,
    kind: look.kind,
    width: metres(spec.width),
    rearX: round(a.rearX),
    frontX: round(a.frontX),
    deck: round(f.deck),
    underside: round(f.underside),
    track: round(f.track),
    wheelRadius: round(f.radius),
    axleZ: f.axleZ.map(round),
    wheelWidth: TRAILER_WHEEL_WIDTH,
    swingMargin: SWING_MARGIN,
    axleHalf: AXLE_HALF_THICKNESS,
    rearAxleXs: a.rearAxles.map((axle) => round(axle.x)),
    rail: { halfGap: RAIL_HALF_GAP, width: RAIL_WIDTH },
    ramp: { gap: RAMP_GAP, width: RAMP_WIDTH },
    marking: {
      strip: CONTOUR_STRIP,
      markerLength: MARKER_LENGTH,
      markerHeight: MARKER_HEIGHT,
      spacing: MARKER_SPACING,
      endMargin: MARKING_END_MARGIN,
    },
    guard: {
      depth: metres(spec.underrunGuard.depth),
      inset: metres(spec.underrunGuard.inset),
    },
    tailLamp: {
      inset: metres(spec.tailLamp.inset),
      width: metres(spec.tailLamp.width),
      sill: metres(spec.tailLamp.sill),
      height: metres(spec.tailLamp.height),
    },
    dolly: {
      eyeX: round(a.eye.x),
      eyeZ: round(a.eye.z),
      eyeBlock: EYE_BLOCK,
      turntableX: round(a.turntable.x),
      spread: DRAWBAR_SPREAD,
      armRadius: round(ARM_HEIGHT / 2),
      kink: round(f.kink),
      plateRadius: PLATE_RADIUS,
      plateTop: round(f.plateTop),
      plateBottom: round(f.plateBottom),
      plateMid: round(f.plateMid),
      postHalf: POST_HALF_WIDTH,
      axleX: round(a.frontAxle.x),
    },
    ...(look.kind === 'low-loader' ? { lowLoader: lowLoaderDeck(spec) } : {}),
    hues: HUES[look.kind],
  };
}
