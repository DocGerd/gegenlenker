import type { TruckSpec } from '../contracts/vehicle';
import { SOURCES, estimate, sourced } from './sources';

const eyeAboveFloor =
  'cab floor 1.1 m above ground (render model), seated eye 1.25 m above it: seat height plus sitting eye height; no source found';
const typical = 'typical for the vehicle class, no source found';
const inBumper = "in the bumper, chosen inside UN R48 6.2.4.2's 1,200 mm; no source found";
const onFloor =
  "on the floor's rear face, chosen inside UN R48 6.4.4.2's 1,200 mm; no source found";

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
    height: estimate(2350, eyeAboveFloor),
    behindBumper: estimate(1000, typical),
    leftOfCentre: estimate(600, 'about 0.65 m inboard of the 2.5 m cab side; no source found'),
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
  cab: {
    windscreenInset: estimate(149, typical),
    glassSill: estimate(900, typical),
    glassHeight: estimate(756, typical),
    sideGlassSetback: estimate(176, typical),
    sideGlassLength: estimate(814, typical),
    grilleWidth: estimate(1245, typical),
    grilleSill: estimate(144, typical),
    grilleHeight: estimate(540, typical),
    headlampInset: estimate(125, typical),
    headlampWidth: estimate(398, typical),
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
