import type { TrailerSpec } from '../contracts/vehicle';
import { SOURCES, estimate, sourced } from './sources';

const typical = 'typical for the vehicle class, no source found';
const limitBasis = 'mechanical stop near 90°: drawbar meets frame or truck rear corner';

export const hueffermannHpa2481L: TrailerSpec = {
  id: 'hueffermann-hpa-24-81-l',
  name: 'Hüffermann HPA 24.81 L',
  body: 'low-loader',
  drawbar: estimate(2600, 'from comparable model HPA 20.67 LT'),
  wheelbase: estimate(5600, 'from platform length and typical axle positions'),
  rearAxleCount: estimate(2, 'inferred from 24 t gross weight and model family'),
  rearAxleSpacing: estimate(1310, typical),
  frontOverhang: estimate(900, typical),
  rearOverhang: estimate(2220, 'fitted to sourced overall length'),
  lengthToEye: sourced(10420, SOURCES.H),
  width: sourced(2550, SOURCES.H),
  track: estimate(2040, typical),
  deckHeight: estimate(700, typical),
  couplingLimit: estimate(80, limitBasis),
  turntableLimit: estimate(85, limitBasis),
  underrunGuard: {
    depth: estimate(50, typical),
    inset: estimate(100, typical),
    lowerEdge: estimate(300, typical),
    height: estimate(250, typical),
    strutOffset: estimate(640, typical),
    strutWidth: estimate(100, typical),
  },
  tailLamp: {
    inset: estimate(405, 'on the loading ramps, no source found'),
    width: estimate(540, 'on the loading ramps, no source found'),
    sill: estimate(100, typical),
    height: estimate(200, typical),
  },
  mudflap: {
    gap: estimate(100, typical),
    clearance: estimate(125, typical),
    height: estimate(825, typical),
  },
};
