import type { Layers, Object3D, PerspectiveCamera } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type { ResolvedLayout } from '../contracts/layout';
import type { LampSwitches, Rect, RenderFrame, ScenePalette } from '../contracts/render';
import type { SimSnapshot } from '../contracts/sim';
import type { TrailerSpec, TruckSpec } from '../contracts/vehicle';
import type { GovernorTrace } from './governor';
import type { GpuOffer } from './gpu-backend';
import type { Look } from './look';
/** three.js default layer: every camera sees it. */
export const DEFAULT_LAYER = 0;
export const AIDS_LAYER = 1; // seen by the top-down camera only
/** Far plane of the cockpit and mirror cameras; the chase camera adds its farthest eye distance. */
export const CAMERA_FAR = 400;
export const PERSPECTIVE_LAYER = 2; // seen by the perspective cameras only
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
export const SHADOW_ONLY_LAYER = 5; // seen by no camera: casters stood in for what is drawn elsewhere
/**
 * Set on the yard's casters, which are drawn in perspective, besides their drawing layer: what the
 * floodlights' static shadow cameras draw, so a vehicle never lands in a map rendered once.
 */
export const YARD_CASTER_LAYER = 6;
/** What the sun's shadow camera draws: no aids, and not the cockpit-only interior. */
export const SHADOW_CASTER_LAYERS = [
  DEFAULT_LAYER,
  PERSPECTIVE_LAYER,
  CAB_LAYER,
  SHADOW_ONLY_LAYER,
];
/** The sim-plane point and radius (m) the sun shadow follows. */
export type ShadowFocus = { readonly x: number; readonly y: number; readonly radius: number };
export const COCKPIT_LAYERS = [PERSPECTIVE_LAYER, INTERIOR_LAYER];
export const MIRROR_LAYERS = [PERSPECTIVE_LAYER, CAB_LAYER];
export const CHASE_LAYERS = [PERSPECTIVE_LAYER, CAB_LAYER];
export const TOP_DOWN_LAYERS = [AIDS_LAYER];
const lostRenderers = new WeakSet<WebGPURenderer>();
/** For the loss handler, which replaces three's and so its private loss flag. */
export function markLost(gpu: WebGPURenderer): void {
  lostRenderers.add(gpu);
}
/** Whether `gpu` lost its device or WebGL context. */
export function gpuLost(gpu: WebGPURenderer): boolean {
  if (lostRenderers.has(gpu)) return true;
  // asking WebGPU for its context would take the canvas
  if ((gpu.backend as { isWebGPUBackend?: boolean } | undefined)?.isWebGPUBackend === true) {
    return false;
  }
  const context = gpu.getContext() as { isContextLost?: () => boolean } | null;
  return context?.isContextLost?.() === true;
}
export function enableLayers(layers: Layers, ids: readonly number[]): void {
  for (const id of ids) layers.enable(id);
}
export interface VehicleVisual {
  readonly object: Object3D;
  /** `lamps` absent means the look's default. */
  update(snapshot: SimSnapshot, lamps?: LampSwitches): void;
  setLook(look: Look): void;
  dispose(): void;
}
export interface Environment {
  readonly object: Object3D; // ground, markings, obstacles, lights
  update(frame: RenderFrame, focus: ShadowFocus): void;
  setLook(look: Look): void;
  dispose(): void;
}
export interface AidsLayer {
  readonly object: Object3D;
  update(frame: RenderFrame): void;
  setLook(look: Look): void;
  dispose(): void;
}
/** What a cockpit interior is placed against each cockpit frame; the rects are in CSS px. */
export interface InteriorView {
  /** Turned by the head, so an interior that stays in the cab must not take its orientation from it. */
  readonly camera: PerspectiveCamera;
  /** The truck's heading. */
  readonly heading: number;
  readonly cockpit: Rect;
  readonly mirrorLeft: Rect | null;
  readonly mirrorRight: Rect | null;
}

/** The cab around the driver's eye. Every drawn part is on `INTERIOR_LAYER` alone. */
export interface CockpitInterior {
  readonly object: Object3D;
  /** `eye`: placed in world space from the camera; `truck`: a child of the truck's object, moving with it. */
  readonly frame: 'eye' | 'truck';
  /**
   * Fixes the interior to `view` before each cockpit frame. The renderer has already updated the
   * scene's world matrices (the scene does not update itself), so `place` sets the object's local
   * transform and updates its own world matrices.
   */
  place(view: InteriorView): void;
  /** Whether it stays in the cab while the head turns; one fixed to the eye needs the head forward. */
  readonly looksAround?: boolean;
  setLook(look: Look): void;
  dispose(): void;
}

export type RendererParts = {
  /** Called each time a GPU renderer is ready, again after a loss with the new one; parts move to the latest. */
  readonly onRenderer?: (renderer: WebGPURenderer) => void;
  /** Called on each start with a reader of the resolution governor's trace. */
  readonly onGovernor?: (trace: () => GovernorTrace) => void;
  /** A device to start WebGPU on, or none for WebGL 2; absent means WebGL 2. */
  readonly gpuDevice?: () => Promise<GpuOffer>;
  readonly truck: (spec: TruckSpec, palette: ScenePalette) => VehicleVisual;
  readonly trailer: (spec: TrailerSpec, palette: ScenePalette) => VehicleVisual;
  readonly environment: (layout: ResolvedLayout, palette: ScenePalette) => Environment;
  readonly interior: (truck: TruckSpec, palette: ScenePalette) => CockpitInterior;
  readonly aids: (
    truck: TruckSpec,
    trailer: TrailerSpec,
    layout: ResolvedLayout,
    palette: ScenePalette,
  ) => AidsLayer;
};
