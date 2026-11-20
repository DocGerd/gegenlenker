import type { TruckSpec } from '../contracts/vehicle';
import { truckAnchors } from '../vehicles/anchors';
import { cabShellParams } from './cab-dims';

// No `three` import: the angles are plain azimuths about the eye's forward axis.

/** One A-pillar as the eye sees it: azimuths in radians from the forward axis, towards the pillar's own side. */
export type PillarSight = {
  /** The windscreen edge. */
  readonly inner: number;
  /** The front edge of the side window. */
  readonly outer: number;
  readonly covered: number;
};

/** What the cab's glass shows the driver's eye, from the shell's windscreen and side windows. */
export type CabSight = {
  /** Azimuth of the windscreen's centre, positive to the right of the forward axis. */
  readonly windscreenCentre: number;
  readonly left: PillarSight;
  readonly right: PillarSight;
};

export function cabSight(spec: TruckSpec): CabSight {
  const { eye } = truckAnchors(spec);
  const { width, frontX, cab } = cabShellParams(spec);
  const half = width / 2;
  const screen = half - cab.windscreenInset;
  const ahead = frontX - eye.x;
  const aheadSide = ahead - cab.sideGlassSetback;
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
