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
  readonly cabGlb: boolean;
  readonly vehicleGlb: boolean;
  readonly chaseView: boolean;
  /** Dashboard, pillars, header and visor around the cockpit view, and the mirror housings. */
  readonly cockpitInterior: boolean;
  readonly groundTexture: boolean;
  readonly pbr: boolean;
  /** HDRI sun and sky light in the perspective views, tone-mapped in their perspective-only materials. */
  readonly perspectiveLighting: boolean;
  /** Distance haze in the graded materials; needs `perspectiveLighting`. */
  readonly aerialPerspective: boolean;
  /** HDRI sky dome, also what the vehicles reflect; a download. */
  readonly hdriSky: boolean;
};

const BALANCED: QualityFlags = {
  pixelRatioCap: 2,
  mirrorMsaa: 4,
  skyline: true,
  yardDetail: true,
  cabGlb: true,
  vehicleGlb: true,
  chaseView: true,
  cockpitInterior: true,
  groundTexture: false,
  pbr: false,
  perspectiveLighting: true,
  aerialPerspective: true,
  hdriSky: false,
};

export const QUALITY_FLAGS: Readonly<Record<GraphicsPreset, QualityFlags>> = {
  low: {
    pixelRatioCap: 1,
    mirrorMsaa: 0,
    skyline: false,
    yardDetail: false,
    cabGlb: false,
    vehicleGlb: false,
    chaseView: false,
    cockpitInterior: false,
    groundTexture: false,
    pbr: false,
    perspectiveLighting: false,
    aerialPerspective: false,
    hdriSky: false,
  },
  balanced: BALANCED,
  high: { ...BALANCED, groundTexture: true, pbr: true, hdriSky: true },
};
