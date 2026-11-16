import type { TruckSpec } from '../contracts/vehicle';
import { SOURCES, estimate, sourced } from './sources';

const eyeBasis = 'driver eye point estimate';
const mirrorBasis = 'mirror point estimate';
const steeringBasis = 'steering estimate';

export const arocs1835Ak: TruckSpec = {
  id: 'arocs-1835-ak',
  name: 'Mercedes-Benz Arocs 1835 AK',
  body: 'tipper',
  wheelbase: sourced(3900, SOURCES.B),
  frontOverhang: estimate(1450, 'estimate'),
  rearOverhang: estimate(1435, 'estimate'),
  length: sourced(6785, SOURCES.B),
  width: sourced(2500, SOURCES.A),
  frontTrack: estimate(2050, 'estimate'),
  rearTrack: estimate(1850, 'estimate'),
  couplingOffset: estimate(1500, 'estimate'),
  turningRadius: sourced(8150, SOURCES.A),
  eye: {
    height: estimate(2150, eyeBasis),
    behindBumper: estimate(1300, eyeBasis),
    leftOfCentre: estimate(500, eyeBasis),
  },
  mirror: {
    lateral: estimate(1400, mirrorBasis),
    glassOutboard: estimate(200, mirrorBasis),
    behindBumper: estimate(700, mirrorBasis),
    height: estimate(2200, mirrorBasis),
  },
  steering: {
    lockToLockTurns: estimate(5.0, steeringBasis),
    maxRate: estimate(1.5, steeringBasis),
  },
};
