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
};
