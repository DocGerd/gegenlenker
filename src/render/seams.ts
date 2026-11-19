import type { Layers, Object3D, WebGLRenderer } from 'three';
import type { ResolvedLayout } from '../contracts/layout';
import type { RenderFrame, ScenePalette } from '../contracts/render';
import type { SimSnapshot } from '../contracts/sim';
import type { TrailerSpec, TruckSpec } from '../contracts/vehicle';
import type { QualityFlags } from './quality';
/** three.js default layer: every camera sees it. */
export const DEFAULT_LAYER = 0;
export const AIDS_LAYER = 1; // seen by the top-down camera only
/** Far plane of the cockpit, mirror and chase cameras. */
export const CAMERA_FAR = 400;
export const SKY_LAYER = 2; // seen by the perspective cameras only
export const CAB_LAYER = 3; // seen by the mirrors and the chase camera: the cockpit eye sits inside the cab
/** Dash pattern (m) of the forward corridor; the Aids legend draws the same. */
export const AID_DASH_ON = 0.6;
export const AID_DASH_OFF = 0.4;
/** Stroke widths (m) of the top-down aids, each on a dark casing `casing` wide at either edge; the Aids legend draws the same. */
export const AID_STROKE = {
  path: 0.2,
  corridor: 0.1,
  bar: 0.2,
  pivot: 0.12,
  ghost: 0.1,
  track: 0.1,
  casing: 0.06,
} as const;
export const INTERIOR_LAYER = 4; // seen by the cockpit camera only: the cab interior around the driver's eye
export const COCKPIT_LAYERS = [SKY_LAYER, INTERIOR_LAYER];
export const MIRROR_LAYERS = [SKY_LAYER, CAB_LAYER];
export const CHASE_LAYERS = [SKY_LAYER, CAB_LAYER];
export const TOP_DOWN_LAYERS = [AIDS_LAYER];
export function enableLayers(layers: Layers, ids: readonly number[]): void {
  for (const id of ids) layers.enable(id);
}
export interface VehicleVisual {
  readonly object: Object3D;
  update(snapshot: SimSnapshot): void;
  setQuality(flags: QualityFlags): void;
  dispose(): void;
}
export interface Environment {
  readonly object: Object3D; // ground, markings, obstacles, lights
  update(frame: RenderFrame): void;
  setQuality(flags: QualityFlags): void;
  dispose(): void;
}
export interface AidsLayer {
  readonly object: Object3D;
  update(frame: RenderFrame): void;
  dispose(): void;
}
export type RendererParts = {
  /** Called each time a GPU renderer is ready, again after a loss with the new one; parts move to the latest. */
  readonly onRenderer?: (renderer: WebGLRenderer) => void;
  readonly truck: (spec: TruckSpec, palette: ScenePalette) => VehicleVisual;
  readonly trailer: (spec: TrailerSpec, palette: ScenePalette) => VehicleVisual;
  readonly environment: (layout: ResolvedLayout, palette: ScenePalette) => Environment;
  readonly aids: (
    truck: TruckSpec,
    trailer: TrailerSpec,
    layout: ResolvedLayout,
    palette: ScenePalette,
  ) => AidsLayer;
};
