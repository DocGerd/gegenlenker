import type { TruckSpec } from '../contracts/vehicle';
import { SOURCES, estimate, sourced } from './sources';

const doorGlassToBPillar =
  'door glass reaches the interior B-pillar 0.55 m behind the eye (render model), so the driver sees abeam; no source found';
const eyeAboveFloor =
  'cab floor 1.1 m above ground (render model), seated eye 1.35 m above it (4x4 tipper seat sits higher than the MAN distribution cab); no source found';
const mirrorHeight =
  'class II glass from mid-window to near the roof line on THW photos (https://commons.wikimedia.org/wiki/File:Dossenheim_-_Mercedes_Benz_Arocs_1835_AK_-_Technisches_Hilfswerk_Mannheim_-_THW_81451_-_2016-05-08_16-03-18.jpg, https://commons.wikimedia.org/wiki/File:MAN_LE_18-280_THW.jpg); no measured source';
const mirrorArms =
  'housing 0.3 m clear of the cab side, on arms straight out from the A-pillar (render model); no source found';
const mirrorPillar =
  'arms meet the cab between its front corner and the side window, so the heads stand beside the A-pillar (render model); no source found';
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
  frameTop: estimate(1100, 'chassis top and cab floor of the render model; no source found'),
  bodyTop: estimate(2500, 'tipper wall top of the procedural body (render model); no source found'),
  eye: {
    height: estimate(2450, eyeAboveFloor),
    behindBumper: estimate(1300, typical),
    leftOfCentre: estimate(600, 'about 0.65 m inboard of the 2.5 m cab side; no source found'),
  },
  mirror: {
    lateral: estimate(1470, mirrorArms),
    glassOutboard: estimate(200, typical),
    behindBumper: estimate(215, mirrorPillar),
    height: estimate(2550, mirrorHeight),
    wideBelow: estimate(400, 'class IV glass stacked under the class II, no source found'),
  },
  steering: {
    lockToLockTurns: estimate(5.0, typical),
    maxRate: estimate(1.5, typical),
  },
  cab: {
    height: estimate(2900, 'cab roof of the render model; no source found'),
    windscreenInset: estimate(150, typical),
    glassSill: estimate(900, typical),
    glassHeight: estimate(756, typical),
    sideGlassSetback: estimate(176, typical),
    sideGlassLength: estimate(1674, doorGlassToBPillar),
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
