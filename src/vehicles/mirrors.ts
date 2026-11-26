import type { MirrorId, TruckId, TruckSpec, Vec3 } from '../contracts/vehicle';
import { truckAnchors } from './anchors';
import { cabGlass, metres } from './cab';

// three's MathUtils.degToRad, so the optics stay bit for bit what the mirror cameras were built with.
const DEG2RAD = Math.PI / 180;
const degToRad = (degrees: number): number => degrees * DEG2RAD;

/** Class VI's width over its height. */
export const FRONT_ASPECT = 2;
/** Class IV's width over its height. */
export const WIDE_ASPECT = 5 / 3;
/** The class V mirror's width over its height. */
export const CLOSE_ASPECT = 2;
/**
 * The class II glass's width over its height (`GLASS.main`, `tools/blender/cab_shell.py`). The
 * mirror views follow their layout rect instead; gameplay reads this, so it never depends on the window.
 */
export const CLASS_II_GLASS_ASPECT = 0.2 / 0.36;

/** One mirror camera's optics: angles in radians, `fov` vertical in degrees (three's convention). */
export type MirrorOptics = {
  /** From straight back; positive turns toward the truck's right. Null: outward by the truck's class II yaw. */
  readonly yaw: number | null;
  readonly pitch: number;
  readonly roll: number;
  readonly fov: number;
  /** Width over height; null follows the view rect. */
  readonly aspect: number | null;
};

/**
 * Class II mirrors look this far outward of straight back, per truck: enough to frame the body side and
 * the whole R46 field (shell-visibility.test.ts).
 */
export const CLASS_II_YAW: Readonly<Record<TruckId, number>> = {
  'man-le-18-280': degToRad(4),
  'arocs-1835-ak': degToRad(6),
};

export const CLASS_II_OPTICS = {
  yaw: null,
  pitch: degToRad(-8),
  roll: 0,
  fov: 46,
  aspect: null,
} as const satisfies MirrorOptics;

/** Class IV looks this far outward of straight back, and down: its field is the ground beside the truck. */
export const WIDE_YAW = degToRad(22);
export const CLASS_IV_OPTICS = {
  pitch: degToRad(-20),
  roll: 0,
  fov: 62,
  aspect: WIDE_ASPECT,
} as const satisfies Omit<MirrorOptics, 'yaw'>;

/**
 * Class V: from beside the A-pillar, outward and down onto the ground between the cab side and 2 m out.
 * The camera is rolled upside down, so the cab side lies on the image's top edge.
 */
export const CLASS_V_OPTICS = {
  yaw: Math.PI / 2,
  pitch: (-75 * Math.PI) / 180,
  roll: Math.PI,
  fov: 51,
  aspect: CLOSE_ASPECT,
} as const satisfies MirrorOptics;

/**
 * Class VI: from above the cab front, forward and down onto the ground ahead of the bumper. The
 * camera is rolled upside down, so the bumper lies on the image's top edge.
 */
export const CLASS_VI_OPTICS = {
  yaw: Math.PI,
  pitch: degToRad(-80),
  roll: Math.PI,
  fov: 47,
  aspect: FRONT_ASPECT,
} as const satisfies MirrorOptics;

/** The optics of mirror `id` on truck `truck`, yaw resolved and class II at its glass aspect. */
export function mirrorOptics(
  id: MirrorId,
  truck: TruckId,
): MirrorOptics & { readonly yaw: number; readonly aspect: number } {
  switch (id) {
    case 'mirrorLeft':
      return { ...CLASS_II_OPTICS, yaw: -CLASS_II_YAW[truck], aspect: CLASS_II_GLASS_ASPECT };
    case 'mirrorRight':
      return { ...CLASS_II_OPTICS, yaw: CLASS_II_YAW[truck], aspect: CLASS_II_GLASS_ASPECT };
    case 'wideLeft':
      return { ...CLASS_IV_OPTICS, yaw: -WIDE_YAW };
    case 'wideRight':
      return { ...CLASS_IV_OPTICS, yaw: WIDE_YAW };
    case 'front':
      return CLASS_VI_OPTICS;
    case 'close':
      return CLASS_V_OPTICS;
  }
}

/** Metres ahead of the cab front (on a short boom), and inboard of its passenger side, that the class VI mirror sits. */
const FRONT_AHEAD = 0.2;
const FRONT_INBOARD = 0.25;
/** Below the cab's roof: R46 15.2.2.7 keeps class V and VI parts 2 m or more above the ground. */
const FRONT_BELOW_ROOF = 0.1;

/** The class VI mirror's eye in the body frame: top front of the cab, passenger side, ahead of the glass. */
export function frontMirrorMount(truck: TruckSpec): Vec3 {
  const { frontX, half } = cabGlass(truck);
  return {
    x: frontX + FRONT_AHEAD,
    y: -(half - FRONT_INBOARD),
    z: metres(truck.cab.height) - FRONT_BELOW_ROOF,
  };
}

/** Metres ahead of the ocular plane, and outboard of the cab's passenger side, that the class V mirror sits (near the A-pillar). */
const CLOSE_AHEAD = 0.2;
const CLOSE_OUTBOARD = 0.15;
/** Below 2.4 m, so only R46 15.2.4.5.1-.4 apply; 2 m or more, as 15.2.2.7 requires. */
const CLOSE_HEIGHT = 2.3;

/** The class V mirror's eye in the body frame: an estimate, not a vehicle Param. */
export function closeMirrorMount(truck: TruckSpec): Vec3 {
  const { half } = cabGlass(truck);
  const { eye } = truckAnchors(truck);
  return { x: eye.x + CLOSE_AHEAD, y: -(half + CLOSE_OUTBOARD), z: CLOSE_HEIGHT };
}

/** Where each mirror's camera sits on a truck, in the body frame. */
export type MirrorMounts = Readonly<Record<MirrorId, Vec3>>;

export function mirrorMounts(truck: TruckSpec): MirrorMounts {
  const { mirrorLeft, mirrorRight, wideLeft, wideRight } = truckAnchors(truck);
  return {
    mirrorLeft,
    mirrorRight,
    wideLeft,
    wideRight,
    front: frontMirrorMount(truck),
    close: closeMirrorMount(truck),
  };
}
