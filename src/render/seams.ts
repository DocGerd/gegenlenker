import type { Object3D } from 'three';
import type { ResolvedLayout } from '../contracts/layout';
import type { RenderFrame, ScenePalette } from '../contracts/render';
import type { SimSnapshot } from '../contracts/sim';
import type { TrailerSpec, TruckSpec } from '../contracts/vehicle';
export const AIDS_LAYER = 1; // seen by the top-down camera only
export const SKY_LAYER = 2; // seen by the perspective cameras only
export const CAB_LAYER = 3; // seen by the mirrors only: the cockpit eye sits inside the cab
export interface VehicleVisual {
  readonly object: Object3D;
  update(snapshot: SimSnapshot): void;
  dispose(): void;
}
export interface Environment {
  readonly object: Object3D; // ground, markings, obstacles, lights
  update(frame: RenderFrame): void;
  dispose(): void;
}
export interface AidsLayer {
  readonly object: Object3D;
  update(frame: RenderFrame): void;
  dispose(): void;
}
export type RendererParts = {
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
