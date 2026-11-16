import type { TrailerSpec } from '../contracts/vehicle';
import { SOURCES, estimate, sourced } from './sources';

const limitBasis = 'mechanical stop near 90°: drawbar meets frame or truck rear corner';

export const hueffermannHpa2481L: TrailerSpec = {
  id: 'hueffermann-hpa-24-81-l',
  name: 'Hüffermann HPA 24.81 L',
  body: 'low-loader',
  drawbar: estimate(2600, 'estimate'),
  wheelbase: estimate(5600, 'turntable to tandem centre'),
  rearAxleCount: estimate(2, 'rear tandem'),
  rearAxleSpacing: estimate(1310, 'tandem spacing'),
  frontOverhang: estimate(900, 'estimate'),
  rearOverhang: estimate(2220, 'sourced length − drawbar − wheelbase'),
  lengthToEye: sourced(10420, SOURCES.H),
  width: sourced(2550, SOURCES.H),
  track: estimate(2040, 'estimate'),
  deckHeight: estimate(700, 'estimate'),
  couplingLimit: estimate(80, limitBasis),
  turntableLimit: estimate(85, limitBasis),
};
