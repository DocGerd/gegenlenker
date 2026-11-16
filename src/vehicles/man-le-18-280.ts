import type { TruckSpec } from '../contracts/vehicle';
import { SOURCES, estimate, sourced } from './sources';

const eyeBasis = 'driver eye point estimate';
const mirrorBasis = 'mirror point estimate';
const steeringBasis = 'steering estimate';

export const manLe18280: TruckSpec = {
  id: 'man-le-18-280',
  name: 'MAN LE 18.280',
  body: 'platform',
  wheelbase: estimate(3900, 'fleet wheelbase; 3,600 / 3,900 / 4,500 offered'),
  frontOverhang: estimate(1320, 'estimate'),
  rearOverhang: sourced(1100, SOURCES.D),
  width: sourced(2490, SOURCES.D),
  frontTrack: estimate(1950, 'estimate'),
  rearTrack: estimate(1800, 'estimate'),
  couplingOffset: estimate(1250, 'estimate'),
  turningRadius: sourced(7800, SOURCES.D),
  eye: {
    height: estimate(1950, eyeBasis),
    behindBumper: estimate(1000, eyeBasis),
    leftOfCentre: estimate(400, eyeBasis),
  },
  mirror: {
    lateral: estimate(1250, mirrorBasis),
    glassOutboard: estimate(200, mirrorBasis),
    behindBumper: estimate(600, mirrorBasis),
    height: estimate(2000, mirrorBasis),
  },
  steering: {
    lockToLockTurns: estimate(5.0, steeringBasis),
    maxRate: estimate(1.5, steeringBasis),
  },
};
