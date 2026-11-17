import type { TruckSpec } from '../contracts/vehicle';
import { SOURCES, estimate, sourced } from './sources';

const typical = 'typical for the vehicle class, no source found';

export const manLe18280: TruckSpec = {
  id: 'man-le-18-280',
  name: 'MAN LE 18.280',
  body: 'platform',
  wheelbase: estimate(3900, 'middle of three sourced wheelbase options'),
  frontOverhang: estimate(1320, 'derived from sourced chassis length'),
  rearOverhang: sourced(1100, SOURCES.D),
  width: sourced(2490, SOURCES.D),
  frontTrack: estimate(1950, typical),
  rearTrack: estimate(1800, typical),
  couplingOffset: estimate(1250, 'frame end plus coupling crossmember, no source found'),
  turningRadius: sourced(7800, SOURCES.D),
  eye: {
    height: estimate(1950, typical),
    behindBumper: estimate(1000, typical),
    leftOfCentre: estimate(400, typical),
  },
  mirror: {
    lateral: estimate(1250, typical),
    glassOutboard: estimate(200, typical),
    behindBumper: estimate(600, typical),
    height: estimate(2000, typical),
  },
  steering: {
    lockToLockTurns: estimate(5.0, typical),
    maxRate: estimate(1.5, typical),
  },
  cab: {
    windscreenInset: estimate(149, typical),
    glassSill: estimate(900, typical),
    glassHeight: estimate(756, typical),
    sideGlassSetback: estimate(176, typical),
    sideGlassLength: estimate(814, typical),
    grilleWidth: estimate(1245, typical),
    grilleSill: estimate(144, typical),
    grilleHeight: estimate(540, typical),
    headlampInset: estimate(125, typical),
    headlampWidth: estimate(398, typical),
    lampSill: estimate(180, typical),
    lampHeight: estimate(396, typical),
  },
  bumperInset: estimate(100, typical),
  tailLamp: {
    inset: estimate(100, typical),
    width: estimate(274, typical),
    sill: estimate(20, typical),
    height: estimate(160, typical),
  },
  mudflap: {
    gap: estimate(100, typical),
    clearance: estimate(125, typical),
    height: estimate(825, typical),
  },
};
