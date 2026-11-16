import type { ResolvedLayout } from './layout';
import type { SimSnapshot, Vec2 } from './sim';
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
export type ViewMode = 'drive' | 'replay';
export type TopDownMode = 'follow' | 'yard';
export type AidFlags = {
  readonly pivots: boolean;
  readonly path: boolean;
  readonly tracks: boolean;
  readonly ghost: boolean;
};
export type ScenePaletteKey =
  | 'sky'
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
  | 'accent';
export type ScenePalette = Readonly<Record<ScenePaletteKey, number>>;
export type RenderFrame = {
  readonly snapshot: SimSnapshot;
  readonly views: ViewRects;
  readonly topDown: TopDownMode;
  readonly aids: AidFlags;
  readonly predicted: readonly Vec2[];
};
export type RenderStats = {
  readonly fps: number;
  readonly frameP95Ms: number;
  readonly resolutionScale: number;
  readonly drawCalls: number;
  readonly glRenderer: string;
  readonly contextLost: boolean;
};
export interface SceneRenderer {
  init(canvas: HTMLCanvasElement): void; // throws when WebGL 2 is unavailable
  setScene(
    layout: ResolvedLayout,
    truck: TruckSpec,
    trailer: TrailerSpec,
    palette: ScenePalette,
  ): void;
  resize(cssWidth: number, cssHeight: number): void;
  render(frame: RenderFrame): void;
  stats(): RenderStats;
  dispose(): void;
}
