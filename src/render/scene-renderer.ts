import type {
  FreePose,
  GraphicsPreset,
  LightingMode,
  RenderFrame,
  RenderStats,
} from '../contracts/render';
import type { ResolvedLayout } from '../contracts/layout';
import type { TrailerSpec, TruckSpec } from '../contracts/vehicle';

/** The Einweiser's sight areas, drawn in the top-down view and on the ground of his first-person view; off for the driver. */
export type SightFlags = { readonly top: boolean; readonly ground: boolean };

export interface SceneRenderer {
  /**
   * Rejects with a `GraphicsStartError` when no GPU context can be made on `canvas` or a later call
   * superseded this one, otherwise with the failure. After a loss, call again with a fresh canvas: the scene is kept.
   */
  init(canvas: HTMLCanvasElement): Promise<void>;
  /** `listener` runs when the GPU renderer is lost for good; returns the unsubscribe. */
  onLost(listener: () => void): () => void;
  setScene(layout: ResolvedLayout, truck: TruckSpec, trailer: TrailerSpec): void;
  /** Builds the current scene again under the current quality, keeping the aids and their tracks; no-op without one. */
  rebuildScene(): void;
  /** `listener` runs when an asset attached, detached or failed on its own, so a still frame is stale; returns the unsubscribe. */
  onAttached(listener: () => void): () => void;
  /** Applies at once, to the current scene and to every later one. */
  setQuality(preset: GraphicsPreset): void;
  /** Applies at once, to the current scene and to every later one. */
  setLighting(mode: LightingMode): void;
  /** Applies at once, to the current scene and to every later one; drawn in Einweiser runs only. */
  setSightCones(flags: SightFlags): void;
  resize(cssWidth: number, cssHeight: number): void;
  render(frame: RenderFrame): void;
  /** The outside view's camera as of the last render, to start a free camera from; null while it was not drawn. */
  chasePose(): FreePose | null;
  /** Sim-plane point to screen CSS px as of the last render; null before the first. */
  project(x: number, y: number): { readonly x: number; readonly y: number } | null;
  /** Reports an animation frame on which the caller chose not to render, so frame timing still sees it. */
  skipFrame(): void;
  stats(): RenderStats;
  dispose(): void;
}
