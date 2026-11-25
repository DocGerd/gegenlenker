import type { Prediction, SimSnapshot } from './sim';
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
  /** The class IV wide-angle mirrors, each directly under its class II mirror; null where the preset or the window has no room. */
  readonly wideLeft: Rect | null;
  readonly wideRight: Rect | null;
  /** The class VI front mirror, in the windscreen band; null where the preset or the window has no room. */
  readonly front: Rect | null;
  /** The class V close-proximity mirror, above the right class II mirror; null where the preset or the window has no room. */
  readonly close: Rect | null;
  readonly topDown: Rect;
};
/** The mirrors beyond the two class II ones that the layout makes room for. */
export type ExtraMirrors = {
  readonly front: boolean;
  readonly wide: boolean;
  readonly close: boolean;
};
export const NO_EXTRA_MIRRORS: ExtraMirrors = { front: false, wide: false, close: false };

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
 * In `chase`, `zoom` divides the orbit distance, `panX` is the orbit yaw in radians (wraps) and `panY` the tilt in
 * radians from the default pitch.
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
/** Chase camera azimuth from the truck's forward axis, counter-clockwise from above: the default pose. */
export const CHASE_AZIMUTH = { default: rad(38) } as const;
/** Chase camera pitch above the horizon: the default pose and the range the tilt may reach. */
export const CHASE_PITCH = { default: rad(14), min: rad(5), max: rad(75) } as const;
/** `panY` range in `chase`: the tilt from the default pitch. */
export const CHASE_TILT = {
  min: CHASE_PITCH.min - CHASE_PITCH.default,
  max: CHASE_PITCH.max - CHASE_PITCH.default,
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
/** The time of day the perspective views are lit for. */
export type LightingMode = 'day' | 'night';
export const LIGHTING_MODES: readonly LightingMode[] = ['day', 'night'];
export const DEFAULT_LIGHTING: LightingMode = 'day';
/** The lit tokens the top-down view draws darker at night; each has a `night<Key>` token. */
export type NightLitKey =
  | 'yard'
  | 'pavement'
  | 'street'
  | 'verge'
  | 'kerb'
  | 'cone'
  | 'band'
  | 'wall'
  | 'fence'
  | 'hall'
  | 'ramp'
  | 'lamp'
  | 'parked'
  | 'body'
  | 'cab'
  | 'chassis';
export type ScenePaletteKey =
  | 'sky'
  | 'backdrop'
  | 'nightBackdrop'
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
  | 'nightAccent'
  | 'nightTracks'
  | 'band'
  | 'cladding'
  | `night${Capitalize<NightLitKey>}`;
export type ScenePalette = Readonly<Record<ScenePaletteKey, number>>;
/** The driver's lamp switches; the lamps' own state follows from them and the controls. */
export type LampSwitches = {
  readonly lights: boolean;
  readonly hazard: boolean;
};
/** Where the driver looks, relative to straight ahead in the cockpit view: radians, yaw positive to the left, pitch positive up. */
export type HeadPose = {
  readonly yaw: number;
  readonly pitch: number;
};
export const HEAD_REST: HeadPose = { yaw: 0, pitch: 0 };
/**
 * The free camera of the outside view: eye position in the sim plane (metres, z up) and look
 * direction, yaw counter-clockwise from the x axis like a heading, pitch positive up (radians).
 */
export type FreePose = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly pitch: number;
};
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
  /** Absent means the lighting's default: lights on at night, hazard lights off. */
  readonly lamps?: LampSwitches;
  /** Absent means looking straight ahead; ignored where the cockpit draws no interior asset. */
  readonly head?: HeadPose;
  /** Absent means the outside view orbits; set, it flies from this pose. Ignored in the other views. */
  readonly freePose?: FreePose;
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
  /** Draw calls of the mirror captures in the last frame; part of `drawCalls`. */
  readonly mirrorCalls: number;
  /** Shadow-camera renders in the last frame: one per shadow map, a point light's six faces counting six. */
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
