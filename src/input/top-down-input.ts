import {
  DEFAULT_TOP_DOWN_VIEW,
  type Rect,
  type TopDownMode,
  type TopDownView,
} from '../contracts/render';
import { isFormField } from './keyboard';
import {
  clampView,
  panBy,
  pinch,
  wheelFactor,
  zoomAt,
  type Point,
  type ViewContext,
} from './top-down-view';

export type TopDownInput = {
  /** Switching mode, even to the current one, resets the view. */
  setMode(mode: TopDownMode): void;
  reset(): void;
  /** Re-clamps the view after the pane changed size. */
  relayout(): void;
  dispose(): void;
};

export type TopDownInputOptions = {
  readonly mode: TopDownMode;
  /** The top-down pane in the canvas's CSS px. */
  readonly getRect: () => Rect;
  readonly onChange: (view: TopDownView) => void;
};

const KEY_ZOOM = 1.25;
const MAX_POINTERS = 2;

/**
 * Pans and zooms the top-down pane of the shared canvas: drag, pinch, wheel and keys.
 * Controls and the HUD's buttons sit above the canvas, so their gestures never reach it.
 */
export function createTopDownInput(surface: HTMLElement, opts: TopDownInputOptions): TopDownInput {
  const abort = new AbortController();
  const { signal } = abort;
  let mode = opts.mode;
  let view = DEFAULT_TOP_DOWN_VIEW;
  const pointers = new Map<number, Point>();

  const context = (): ViewContext => {
    const { width, height } = opts.getRect();
    return { mode, width, height };
  };
  const commit = (next: TopDownView): void => {
    if (next.zoom === view.zoom && next.panX === view.panX && next.panY === view.panY) return;
    view = next;
    opts.onChange(view);
  };
  /** Pane-local position of a mouse event, or null outside the pane. */
  const inPane = (e: { clientX: number; clientY: number }): Point | null => {
    const box = surface.getBoundingClientRect();
    const r = opts.getRect();
    const x = e.clientX - box.left - r.x;
    const y = e.clientY - box.top - r.y;
    return x >= 0 && y >= 0 && x <= r.width && y <= r.height && r.width > 0 && r.height > 0
      ? { x, y }
      : null;
  };
  const centre = (ctx: ViewContext): Point => ({ x: ctx.width / 2, y: ctx.height / 2 });

  surface.addEventListener(
    'pointerdown',
    (e) => {
      if (pointers.size >= MAX_POINTERS || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const p = inPane(e);
      if (p === null) return;
      pointers.set(e.pointerId, p);
      surface.setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    { signal },
  );

  surface.addEventListener(
    'pointermove',
    (e) => {
      const before = pointers.get(e.pointerId);
      if (before === undefined) return;
      const rect = opts.getRect();
      const box = surface.getBoundingClientRect();
      const now = { x: e.clientX - box.left - rect.x, y: e.clientY - box.top - rect.y };
      const ctx = context();
      const others = [...pointers].filter(([id]) => id !== e.pointerId);
      const other = others[0]?.[1];
      pointers.set(e.pointerId, now);
      if (ctx.width === 0 || ctx.height === 0) return;
      commit(
        other === undefined
          ? panBy(view, now.x - before.x, now.y - before.y, ctx)
          : pinch(view, [before, other], [now, other], ctx),
      );
    },
    { signal },
  );

  const release = (e: PointerEvent): void => {
    pointers.delete(e.pointerId);
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    surface.addEventListener(type, release, { signal });
  }

  surface.addEventListener(
    'wheel',
    (e) => {
      const p = inPane(e);
      if (p === null) return;
      e.preventDefault();
      const ctx = context();
      commit(zoomAt(view, wheelFactor(e.deltaY, e.deltaMode, e.ctrlKey, ctx.height), p, ctx));
    },
    { signal, passive: false },
  );

  window.addEventListener(
    'keydown',
    (e) => {
      if (e.defaultPrevented || isFormField(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const ctx = context();
      if (e.key === '+' || e.key === '=') commit(zoomAt(view, KEY_ZOOM, centre(ctx), ctx));
      else if (e.key === '-') commit(zoomAt(view, 1 / KEY_ZOOM, centre(ctx), ctx));
      else if (e.key === '0') commit(DEFAULT_TOP_DOWN_VIEW);
      else return;
      e.preventDefault();
    },
    { signal },
  );

  return {
    setMode(next) {
      mode = next;
      commit(DEFAULT_TOP_DOWN_VIEW);
    },
    reset: () => commit(DEFAULT_TOP_DOWN_VIEW),
    relayout() {
      const ctx = context();
      if (ctx.width > 0 && ctx.height > 0) commit(clampView(view, ctx));
    },
    dispose() {
      abort.abort();
      pointers.clear();
    },
  };
}
