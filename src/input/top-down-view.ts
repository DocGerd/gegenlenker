import type { TopDownMode, TopDownView } from '../contracts/render';

export type Point = { readonly x: number; readonly y: number };
/** The pane the view is shown in; `mode` selects the limits. */
export type ViewContext = {
  readonly mode: TopDownMode;
  readonly width: number;
  readonly height: number;
};

export const ZOOM_LIMITS: Readonly<
  Record<TopDownMode, { readonly min: number; readonly max: number }>
> = {
  follow: { min: 0.5, max: 4 },
  yard: { min: 1, max: 16 },
  chase: { min: 0.6, max: 2.5 },
};

/** A quarter turn each way from the default pose: the camera stays ahead of the cab's rear, not inside the body. */
export const CHASE_YAW_LIMIT = Math.PI / 2;
const CHASE_YAW_PER_PIXEL = 0.01;

/** Follow keeps the target this fraction of the visible half-extent from the centre at most. */
const FOLLOW_TARGET_REACH = 0.8;
const WHEEL_PER_PIXEL = 0.002;
const PINCH_WHEEL_BOOST = 5;
const LINE_PIXELS = 16;
const DEFAULT_EPSILON = 1e-6;
/** Below this finger distance the pinch ratio is noise. */
const MIN_PINCH_PIXELS = 1;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function panLimits(zoom: number, ctx: ViewContext): Point {
  const aspect = ctx.width / ctx.height;
  switch (ctx.mode) {
    case 'chase':
      return { x: CHASE_YAW_LIMIT, y: 0 };
    case 'follow':
      return { x: (FOLLOW_TARGET_REACH * aspect) / zoom, y: FOLLOW_TARGET_REACH / zoom };
    case 'yard':
      return { x: aspect * (1 - 1 / zoom), y: 1 - 1 / zoom };
  }
}

export function clampView(view: TopDownView, ctx: ViewContext): TopDownView {
  const { min, max } = ZOOM_LIMITS[ctx.mode];
  const zoom = clamp(view.zoom, min, max);
  const limit = panLimits(zoom, ctx);
  return {
    zoom,
    panX: clamp(view.panX, -limit.x, limit.x),
    panY: clamp(view.panY, -limit.y, limit.y),
  };
}

/** Pane pixel to pane-normalised offset from the centre, in units of the visible half-height at zoom 1 (y up). */
function fromCentre(p: Point, ctx: ViewContext): Point {
  const half = ctx.height / 2;
  return { x: (p.x - ctx.width / 2) / half, y: -(p.y - half) / half };
}

/** Unclamped: the content under the finger follows it. */
function pannedBy(view: TopDownView, dx: number, dy: number, ctx: ViewContext): TopDownView {
  if (ctx.mode === 'chase') return { ...view, panX: view.panX - dx * CHASE_YAW_PER_PIXEL };
  const perPixel = 2 / (view.zoom * ctx.height);
  return { ...view, panX: view.panX - dx * perPixel, panY: view.panY + dy * perPixel };
}

/** Unclamped apart from the zoom limits: the world point under `anchor` stays under it. */
function zoomedAt(view: TopDownView, factor: number, anchor: Point, ctx: ViewContext): TopDownView {
  const { min, max } = ZOOM_LIMITS[ctx.mode];
  const zoom = clamp(view.zoom * factor, min, max);
  if (ctx.mode === 'chase') return { ...view, zoom };
  const n = fromCentre(anchor, ctx);
  const shift = 1 / view.zoom - 1 / zoom;
  return { zoom, panX: view.panX + n.x * shift, panY: view.panY + n.y * shift };
}

export function panBy(view: TopDownView, dx: number, dy: number, ctx: ViewContext): TopDownView {
  return clampView(pannedBy(view, dx, dy, ctx), ctx);
}

export function zoomAt(
  view: TopDownView,
  factor: number,
  anchor: Point,
  ctx: ViewContext,
): TopDownView {
  return clampView(zoomedAt(view, factor, anchor, ctx), ctx);
}

const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Pans by the midpoint's movement, then zooms by the change in finger distance about the new midpoint. */
export function pinch(
  view: TopDownView,
  from: readonly [Point, Point],
  to: readonly [Point, Point],
  ctx: ViewContext,
): TopDownView {
  const before = mid(from[0], from[1]);
  const after = mid(to[0], to[1]);
  const panned = pannedBy(view, after.x - before.x, after.y - before.y, ctx);
  const d0 = Math.hypot(from[1].x - from[0].x, from[1].y - from[0].y);
  const d1 = Math.hypot(to[1].x - to[0].x, to[1].y - to[0].y);
  const zoomed = d0 < MIN_PINCH_PIXELS ? panned : zoomedAt(panned, d1 / d0, after, ctx);
  return clampView(zoomed, ctx);
}

/** `ctrlKey` marks a trackpad pinch, whose deltas are small. */
export function wheelFactor(
  deltaY: number,
  deltaMode: number,
  ctrlKey: boolean,
  paneHeight: number,
): number {
  const unit = deltaMode === 1 ? LINE_PIXELS : deltaMode === 2 ? paneHeight : 1;
  return Math.exp(-deltaY * unit * WHEEL_PER_PIXEL * (ctrlKey ? PINCH_WHEEL_BOOST : 1));
}

export function isDefaultView(view: TopDownView): boolean {
  return (
    Math.abs(view.zoom - 1) < DEFAULT_EPSILON &&
    Math.abs(view.panX) < DEFAULT_EPSILON &&
    Math.abs(view.panY) < DEFAULT_EPSILON
  );
}
