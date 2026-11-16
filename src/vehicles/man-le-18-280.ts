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
};
