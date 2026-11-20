import type { TruckSpec } from '../contracts/vehicle';
import { SOURCES, estimate, sourced } from './sources';

const typical = 'typical for the vehicle class, no source found';
const inBumper = "in the bumper, chosen inside UN R48 6.2.4.2's 1,200 mm; no source found";
const onFloor =
  "on the floor's rear face, chosen inside UN R48 6.4.4.2's 1,200 mm; no source found";

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
    leftOfCentre: estimate(600, 'about 0.65 m inboard of the 2.5 m cab side; no source found'),
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
  cab: {
    windscreenInset: estimate(150, typical),
    glassSill: estimate(900, typical),
    glassHeight: estimate(756, typical),
    sideGlassSetback: estimate(176, typical),
    sideGlassLength: estimate(814, typical),
    grilleWidth: estimate(1250, typical),
    grilleSill: estimate(144, typical),
    grilleHeight: estimate(540, typical),
    headlampInset: estimate(125, typical),
    headlampWidth: estimate(400, typical),
    lampSill: estimate(-250, inBumper),
    lampHeight: estimate(200, inBumper),
  },
  bumperInset: estimate(100, typical),
  tailLamp: {
    inset: estimate(100, typical),
    width: estimate(
      420,
      'chambers for indicator, tail and stop, reversing and fog; no source found',
    ),
    sill: estimate(15, onFloor),
    height: estimate(80, onFloor),
  },
  mudflap: {
    gap: estimate(100, typical),
    clearance: estimate(125, typical),
    height: estimate(825, typical),
  },
};
