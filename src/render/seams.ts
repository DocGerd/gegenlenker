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
export const COCKPIT_LAYERS = [SKY_LAYER];
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
  /** Called once the WebGL renderer exists, for parts that need its capabilities; parts keep the first renderer they see. */
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
