import type { TrailerSpec } from '../contracts/vehicle';
import { SOURCES, estimate, sourced } from './sources';

const limitBasis = 'mechanical stop near 90°: drawbar meets frame or truck rear corner';

export const kroneAzw18: TrailerSpec = {
  id: 'krone-azw-18',
  name: 'Krone AZW 18',
  body: 'box',
  drawbar: sourced(2200, SOURCES.K),
  wheelbase: sourced(5170, SOURCES.K),
  rearAxleCount: sourced(1, SOURCES.K),
  frontOverhang: estimate(600, 'fits a 7.45 m swap body'),
  rearOverhang: estimate(1675, 'length to eye − drawbar − wheelbase'),
  lengthToEye: sourced(9045, SOURCES.K),
  width: estimate(2550, 'estimate'),
  track: estimate(2040, 'estimate'),
  deckHeight: estimate(1280, 'midpoint of 1,190–1,370 frame height'),
  couplingLimit: estimate(80, limitBasis),
  turntableLimit: estimate(85, limitBasis),
};
