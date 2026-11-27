import type { Param, TruckSpec } from '../contracts/vehicle';
import { truckAnchors } from './anchors';

export const round = (value: number): number => Math.round(value * 1e6) / 1e6;
export const metres = (param: Param): number => round(param.value / 1000);

/** One A-pillar as the eye sees it: azimuths in radians from the forward axis, towards the pillar's own side. */
export type PillarSight = {
  /** The windscreen edge. */
  readonly inner: number;
  /** The front edge of the side window. */
  readonly outer: number;
  readonly covered: number;
};

/**
 * What the cab's glass shows the driver's eye, from the shell's windscreen and side windows. The
 * right pillar lies past the cockpit view's edge at every supported pane, so only its covered angle is used.
 */
export type CabSight = {
  /** Azimuth of the windscreen's centre, positive to the right of the forward axis. */
  readonly windscreenCentre: number;
  readonly left: PillarSight;
  readonly right: PillarSight;
};

/**
 * The cab's glass in the body frame, metres: the windscreen in the plane `x = frontX` out to
 * `±screen`, the side windows in the planes `y = ±half` from `sideRear` to `sideFront`, all between
 * `sill` and `top` above the road.
 */
export type CabGlass = {
  readonly frontX: number;
  readonly half: number;
  readonly screen: number;
  readonly sideFront: number;
  readonly sideRear: number;
  readonly sill: number;
  readonly top: number;
};

export function cabGlass(spec: TruckSpec): CabGlass {
  const { cab } = spec;
  const frontX = round(truckAnchors(spec).frontX);
  const half = metres(spec.width) / 2;
  const sideFront = frontX - metres(cab.sideGlassSetback);
  const sill = metres(spec.frameTop) + metres(cab.glassSill);
  return {
    frontX,
    half,
    screen: half - metres(cab.windscreenInset),
    sideFront,
    sideRear: sideFront - metres(cab.sideGlassLength),
    sill,
    top: sill + metres(cab.glassHeight),
  };
}

export function cabSight(spec: TruckSpec): CabSight {
  const { eye } = truckAnchors(spec);
  const { frontX, half, screen } = cabGlass(spec);
  const ahead = frontX - eye.x;
  const aheadSide = ahead - metres(spec.cab.sideGlassSetback);
  // `side` is +1 for the left (+y) pillar; the eye sits at +y, so the left one is nearer.
  const pillar = (side: -1 | 1): PillarSight => {
    const inner = Math.atan2(screen - side * eye.y, ahead);
    const outer = Math.atan2(half - side * eye.y, aheadSide);
    return { inner, outer, covered: outer - inner };
  };
  return {
    windscreenCentre: Math.atan2(eye.y, ahead),
    left: pillar(1),
    right: pillar(-1),
  };
}
