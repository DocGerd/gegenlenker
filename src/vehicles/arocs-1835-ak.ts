import type { TruckSpec } from '../contracts/vehicle';
import { SOURCES, estimate, sourced } from './sources';

const typical = 'typical for the vehicle class, no source found';

export const arocs1835Ak: TruckSpec = {
  id: 'arocs-1835-ak',
  name: 'Mercedes-Benz Arocs 1835 AK',
  body: 'tipper',
  wheelbase: sourced(3900, SOURCES.B),
  frontOverhang: estimate(1450, 'derived from sourced overall length'),
  rearOverhang: estimate(1435, 'derived from sourced overall length'),
  length: sourced(6785, SOURCES.B),
  width: sourced(2500, SOURCES.A),
  frontTrack: estimate(2050, typical),
  rearTrack: estimate(1850, typical),
  couplingOffset: estimate(1500, 'frame end plus coupling crossmember, no source found'),
  turningRadius: sourced(8150, SOURCES.A),
  eye: {
    height: estimate(2150, typical),
    behindBumper: estimate(1300, typical),
    leftOfCentre: estimate(500, typical),
  },
  mirror: {
    lateral: estimate(1400, typical),
    glassOutboard: estimate(200, typical),
    behindBumper: estimate(700, typical),
    height: estimate(2200, typical),
  },
  steering: {
    lockToLockTurns: estimate(5.0, typical),
    maxRate: estimate(1.5, typical),
  },
};
