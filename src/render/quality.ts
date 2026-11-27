import type { GraphicsPreset } from '../contracts/render';

/** What each preset switches on; consumers only read it. Top-down output never depends on it. */
export type QualityFlags = {
  /** Upper bound of the device pixel ratio the canvas renders at. */
  readonly pixelRatioCap: number;
  /** Requested mirror render-target samples, mapped to 0 or 4 (`mirrorSamples`); 0 disables MSAA. */
  readonly mirrorMsaa: number;
  readonly skyline: boolean;
  /** At night about a quarter of the skyline's office windows are lit; needs `skyline`. */
  readonly skylineWindows: boolean;
  /** Perspective yard props; off shows the plain obstacle tokens in the perspective views too. */
  readonly yardDetail: boolean;
  /** The yard kit's meshes and atlases in the perspective views; a download, off until a preset draws it. */
  readonly yardKit: boolean;
  /** Plain shapes for the kit's surroundings wherever the kit is not drawn; needs `yardDetail`. */
  readonly kitStandIns: boolean;
  readonly cabGlb: boolean;
  readonly vehicleGlb: boolean;
  /** Rounded tyres with a tread, dished rims, brake drums and axles in the perspective views, in place of flat discs. */
  readonly wheelDetail: boolean;
  readonly chaseView: boolean;
  /** The class VI front mirror in the cockpit view's windscreen. */
  readonly frontMirror: boolean;
  /** The class IV wide-angle mirrors under the class II ones. */
  readonly wideMirrors: boolean;
  /** The class V close-proximity mirror on the passenger side; Low stays off until the tablet check has measured it. */
  readonly closeMirror: boolean;
  /** Dashboard, pillars, header and visor around the cockpit view, and the mirror housings. */
  readonly cockpitInterior: boolean;
  /** The Blender cab interior in the cockpit view in place of the flat overlay; a download, and needs `cockpitInterior`. */
  readonly interiorGlb: boolean;
  /** The authored ground detail map (slab joints, mottling) in the perspective views; a download, precached once the default preset draws it. */
  readonly groundTexture: boolean;
  /** Photoscanned PBR yard, street and pavement ground with slab joints; a download, and needs `groundTexture`. */
  readonly groundPbr: boolean;
  /** Lit perspective copies of the ground markings; the top-down tokens stay flat. */
  readonly litMarkings: boolean;
  readonly pbr: boolean;
  /** HDRI sun and sky light in the perspective views, tone-mapped in their perspective-only materials. */
  readonly perspectiveLighting: boolean;
  /** Distance haze in the graded materials; needs `perspectiveLighting`. */
  readonly aerialPerspective: boolean;
  /** The sun casts shadows in the perspective views; needs `perspectiveLighting`. */
  readonly sunShadow: boolean;
  /** HDRI sky dome, also what the vehicles reflect; a download. */
  readonly hdriSky: boolean;
  /** At night the lamps light the ground and the yard around the vehicles. */
  readonly lampLight: boolean;
  /** At night the dipped beam and the trailer's rear light cast shadows; needs `lampLight`. */
  readonly lampShadow: boolean;
  /** At night the yard's floodlights and street lamps throw pools on the ground, and their heads glow. */
  readonly yardLight: boolean;
  /** At night two floodlight masts cast static shadows of the yard's props; needs `yardLight` and `perspectiveLighting`. */
  readonly yardShadow: boolean;
};

const BALANCED: QualityFlags = {
  pixelRatioCap: 2,
  mirrorMsaa: 4,
  skyline: true,
  skylineWindows: true,
  yardDetail: true,
  yardKit: false,
  kitStandIns: true,
  cabGlb: true,
  vehicleGlb: true,
  wheelDetail: true,
  chaseView: true,
  frontMirror: true,
  wideMirrors: true,
  closeMirror: true,
  cockpitInterior: true,
  interiorGlb: false,
  litMarkings: true,
  groundTexture: true,
  groundPbr: false,
  pbr: false,
  perspectiveLighting: false,
  aerialPerspective: false,
  sunShadow: false,
  hdriSky: false,
  lampLight: true,
  lampShadow: false,
  yardLight: true,
  yardShadow: false,
};

/** Most draw calls a frame may spend, mirrors included: the requirement for High. */
export const DRAW_CALL_BUDGET = 300;

export const QUALITY_FLAGS: Readonly<Record<GraphicsPreset, QualityFlags>> = {
  low: {
    pixelRatioCap: 1,
    mirrorMsaa: 0,
    skyline: false,
    skylineWindows: false,
    yardDetail: false,
    yardKit: false,
    kitStandIns: false,
    cabGlb: false,
    vehicleGlb: false,
    wheelDetail: false,
    chaseView: false,
    frontMirror: true,
    wideMirrors: true,
    closeMirror: false,
    cockpitInterior: false,
    interiorGlb: false,
    litMarkings: false,
    groundTexture: false,
    groundPbr: false,
    pbr: false,
    perspectiveLighting: false,
    aerialPerspective: false,
    sunShadow: false,
    hdriSky: false,
    lampLight: false,
    lampShadow: false,
    yardLight: false,
    yardShadow: false,
  },
  balanced: BALANCED,
  high: {
    ...BALANCED,
    yardKit: true,
    interiorGlb: true,
    groundPbr: true,
    pbr: true,
    perspectiveLighting: true,
    aerialPerspective: true,
    sunShadow: true,
    hdriSky: true,
    lampShadow: true,
    yardShadow: true,
  },
};

/** Whether the preset offers the outside view. */
export const chaseViewAvailable = (preset: GraphicsPreset): boolean =>
  QUALITY_FLAGS[preset].chaseView;

/** Whether the preset draws the interior asset, which the head can turn about. */
export const lookAroundAvailable = (preset: GraphicsPreset): boolean =>
  QUALITY_FLAGS[preset].cockpitInterior && QUALITY_FLAGS[preset].interiorGlb;
