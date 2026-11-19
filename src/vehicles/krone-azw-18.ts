import type { TrailerSpec } from '../contracts/vehicle';
import { SOURCES, estimate, sourced } from './sources';

const typical = 'typical for the vehicle class, no source found';
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
  width: estimate(2550, typical),
  track: estimate(2040, typical),
  deckHeight: estimate(1280, 'midpoint of 1,190–1,370 frame height'),
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
    inset: estimate(150, typical),
    width: estimate(360, typical),
    sill: estimate(
      -480,
      "below the frame, chosen inside UN R48 6.4.4.2's 1,200 mm; no source found",
    ),
    height: estimate(200, typical),
  },
  mudflap: {
    gap: estimate(100, typical),
    clearance: estimate(125, typical),
    height: estimate(825, typical),
  },
};
