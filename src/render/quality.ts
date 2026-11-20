import type { GraphicsPreset } from '../contracts/render';

/** What each preset switches on; consumers only read it. Top-down output never depends on it. */
export type QualityFlags = {
  /** Upper bound of the device pixel ratio the canvas renders at. */
  readonly pixelRatioCap: number;
  /** Requested mirror render-target samples, mapped to 0 or 4 (`mirrorSamples`); 0 disables MSAA. */
  readonly mirrorMsaa: number;
  readonly skyline: boolean;
  /** Perspective yard props; off shows the plain obstacle tokens in the perspective views too. */
  readonly yardDetail: boolean;
  /** The yard kit's meshes and atlases in the perspective views; a download, off until a preset draws it. */
  readonly yardKit: boolean;
  readonly cabGlb: boolean;
  readonly vehicleGlb: boolean;
  readonly chaseView: boolean;
  /** Dashboard, pillars, header and visor around the cockpit view, and the mirror housings. */
  readonly cockpitInterior: boolean;
  /** The Blender cab interior in the cockpit view in place of the flat overlay; a download, and needs `cockpitInterior`. */
  readonly interiorGlb: boolean;
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
};

const BALANCED: QualityFlags = {
  pixelRatioCap: 2,
  mirrorMsaa: 4,
  skyline: true,
  yardDetail: true,
  yardKit: false,
  cabGlb: true,
  vehicleGlb: true,
  chaseView: true,
  cockpitInterior: true,
  interiorGlb: false,
  litMarkings: true,
  groundTexture: false,
  groundPbr: false,
  pbr: false,
  perspectiveLighting: false,
  aerialPerspective: false,
  sunShadow: false,
  hdriSky: false,
};

/** Most draw calls a frame may spend, mirrors included: the requirement for High. */
export const DRAW_CALL_BUDGET = 300;

export const QUALITY_FLAGS: Readonly<Record<GraphicsPreset, QualityFlags>> = {
  low: {
    pixelRatioCap: 1,
    mirrorMsaa: 0,
    skyline: false,
    yardDetail: false,
    yardKit: false,
    cabGlb: false,
    vehicleGlb: false,
    chaseView: false,
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
  },
  balanced: BALANCED,
  high: {
    ...BALANCED,
    yardKit: true,
    interiorGlb: true,
    groundTexture: true,
    groundPbr: true,
    pbr: true,
    perspectiveLighting: true,
    aerialPerspective: true,
    sunShadow: true,
    hdriSky: true,
  },
};
