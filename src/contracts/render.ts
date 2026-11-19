import type { ResolvedLayout } from './layout';
import type { Prediction, SimSnapshot } from './sim';
import type { TrailerSpec, TruckSpec } from './vehicle';
export type Rect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}; // CSS px, top-left origin
export type ViewRects = {
  readonly cockpit: Rect | null;
  readonly mirrorLeft: Rect | null;
  readonly mirrorRight: Rect | null;
  readonly topDown: Rect;
};
/** The key legend as it is laid out: its right edge from the stage's left, and how far it reaches above the stage's bottom. */
export type LegendBox = {
  readonly right: number;
  readonly height: number;
};
export type ViewMode = 'drive' | 'replay';
/** Which way the screen is split: the top-down pane beside the cockpit (landscape) or above it (portrait). */
export type Orientation = 'landscape' | 'portrait';
/** The top-down pane's share of the screen per orientation: its width in landscape, its height in portrait. */
export type TopDownLayout = Readonly<Record<Orientation, number>>;
export const DEFAULT_TOP_DOWN_LAYOUT: TopDownLayout = { landscape: 0.4, portrait: 0.45 };
/** The widest range a stored share may take; the screen narrows it further (`topDownSplit`). */
export const TOP_DOWN_SHARE_LIMITS: Readonly<
  Record<Orientation, { readonly min: number; readonly max: number }>
> = {
  landscape: { min: 0.25, max: 0.6 },
  portrait: { min: 0.3, max: 0.6 },
};
/** The split as it applies to the current screen. */
export type TopDownSplit = {
  readonly orientation: Orientation;
  /** In use, within `min`..`max`. */
  readonly share: number;
  readonly min: number;
  readonly max: number;
  /** The default for this orientation; `min` and `max` always include it. */
  readonly fallback: number;
};
export type TopDownMode = 'follow' | 'yard' | 'chase';
/**
 * Relative to the mode's default framing; pan is in units of its base half-height, sim-plane axes (y up).
 * In `chase`, `zoom` divides the orbit distance, `panX` is the orbit yaw in radians and `panY` stays 0.
 */
export type TopDownView = {
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
};
export const DEFAULT_TOP_DOWN_VIEW: TopDownView = { zoom: 1, panX: 0, panY: 0 };
/** The views a drive can start in and settings can store; chase is a showcase and never persists. */
export type DrivingView = Exclude<TopDownMode, 'chase'>;
const rad = (degrees: number): number => (degrees * Math.PI) / 180;
/** Chase camera azimuth from the truck's forward axis, counter-clockwise from above: the default pose and the most it may turn either way. */
export const CHASE_AZIMUTH = { default: rad(38), limit: rad(70) } as const;
/** `panX` range in `chase`: keeps the camera ahead of the cab front plane. */
export const CHASE_YAW = {
  min: -CHASE_AZIMUTH.limit - CHASE_AZIMUTH.default,
  max: CHASE_AZIMUTH.limit - CHASE_AZIMUTH.default,
} as const;
/** `zoom` range in `chase`. */
export const CHASE_ZOOM = { min: 0.6, max: 2.5 } as const;
export type AidFlags = {
  readonly pivots: boolean;
  readonly path: boolean;
  readonly tracks: boolean;
  readonly ghost: boolean;
};
/** Which HUD panels the player has folded away: the two top-down panels and the cockpit key legend. */
export type CollapsedPanels = {
  readonly aids: boolean;
  readonly gauges: boolean;
  readonly keys: boolean;
};
/** Perspective-view realism and render cost; the top-down view looks the same at every preset. */
export type GraphicsPreset = 'low' | 'balanced' | 'high';
export const GRAPHICS_PRESETS: readonly GraphicsPreset[] = ['low', 'balanced', 'high'];
export const DEFAULT_GRAPHICS: GraphicsPreset = 'balanced';
export type ScenePaletteKey =
  | 'sky'
  | 'backdrop'
  | 'verge'
  | 'yard'
  | 'pavement'
  | 'street'
  | 'marking'
  | 'kerb'
  | 'wall'
  | 'fence'
  | 'hall'
  | 'ramp'
  | 'lamp'
  | 'parked'
  | 'cone'
  | 'cab'
  | 'body'
  | 'chassis'
  | 'wheel'
  | 'tracks'
  | 'accent'
  | 'band'
  | 'cladding';
export type ScenePalette = Readonly<Record<ScenePaletteKey, number>>;
export type RenderFrame = {
  readonly snapshot: SimSnapshot;
  readonly views: ViewRects;
  readonly topDown: TopDownMode;
  /** Absent means the default framing. */
  readonly topDownView?: TopDownView;
  /** Follow framing keeps the vehicle inside this screen rect (CSS px, as `views`); absent means the whole top-down pane. */
  readonly topDownClear?: Rect;
  readonly aids: AidFlags;
  readonly predicted: Prediction;
  /** Absent means not yet passed. */
  readonly waypointVisited?: boolean;
};
/** The GPU API the renderer draws through. */
export type GraphicsBackend = 'webgpu' | 'webgl2';
/**
 * Why WebGL 2 draws although WebGPU was asked for: no WebGPU device (`unavailable`), WebGPU did
 * not start or three fell back by itself (`failed`), or the WebGPU device was lost (`lost`).
 */
export type WebgpuFallback = 'unavailable' | 'failed' | 'lost';
export type RenderStats = {
  readonly backend: GraphicsBackend;
  /** Null on WebGPU, or when WebGL 2 was asked for or `auto` declined the adapter. */
  readonly webgpuFallback: WebgpuFallback | null;
  readonly fps: number;
  readonly frameP95Ms: number;
  readonly resolutionScale: number;
  readonly drawCalls: number;
  /** Sun shadow map renders in the last frame. */
  readonly shadowPasses: number;
  readonly glRenderer: string;
  readonly contextLost: boolean;
};
/** Why `SceneRenderer.init` rejected, when it is no bug: no GPU context could be made, or a later `init` or `dispose` came first. */
export class GraphicsStartError extends Error {
  readonly reason: 'unavailable' | 'superseded';
  constructor(reason: 'unavailable' | 'superseded', options?: ErrorOptions) {
    super(reason === 'unavailable' ? 'no GPU context could be created' : 'superseded', options);
    this.name = 'GraphicsStartError';
    this.reason = reason;
  }
}
export interface SceneRenderer {
  /**
   * Rejects with a `GraphicsStartError` when no GPU context can be made on `canvas` or a later call
   * superseded this one, otherwise with the failure. After a loss, call again with a fresh canvas: the scene is kept.
   */
  init(canvas: HTMLCanvasElement): Promise<void>;
  /** `listener` runs when the GPU renderer is lost for good; returns the unsubscribe. */
  onLost(listener: () => void): () => void;
  setScene(layout: ResolvedLayout, truck: TruckSpec, trailer: TrailerSpec): void;
  /** Applies at once, to the current scene and to every later one. */
  setQuality(preset: GraphicsPreset): void;
  resize(cssWidth: number, cssHeight: number): void;
  render(frame: RenderFrame): void;
  /** Sim-plane point to screen CSS px as of the last render; null before the first. */
  project(x: number, y: number): { readonly x: number; readonly y: number } | null;
  /** Reports an animation frame on which the caller chose not to render, so frame timing still sees it. */
  skipFrame(): void;
  stats(): RenderStats;
  dispose(): void;
}
