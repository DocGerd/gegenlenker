import {
  DEFAULT_TOP_DOWN_VIEW,
  type Rect,
  type TopDownMode,
  type TopDownView,
} from '../contracts/render';
import { isFormField } from './keyboard';
import { actionFor } from './keymap';
import {
  clampView,
  panBy,
  pinch,
  wheelFactor,
  zoomAt,
  type Point,
  type ViewContext,
} from './top-down-view';

export type ViewInput = {
  /** Switching mode, even to the current one, resets the view. */
  setMode(mode: TopDownMode): void;
  reset(): void;
  /** Re-clamps the view after the pane changed size. */
  relayout(): void;
  dispose(): void;
};

export type ViewInputOptions = {
  readonly mode: TopDownMode;
  /** The top-down pane in the canvas's CSS px. */
  readonly getRect: () => Rect;
  readonly onChange: (view: TopDownView) => void;
};

/** What a pointer's movement did, in the pane's own px. */
export type Gesture =
  | { readonly kind: 'drag'; readonly dx: number; readonly dy: number }
  | {
      readonly kind: 'pinch';
      readonly from: readonly [Point, Point];
      readonly to: readonly [Point, Point];
    };

const MAX_POINTERS_PER_PANE = 2;

/**
 * Each pointer belongs to the pane it went down in, so one finger in each of two panes is two
 * drags, never a pinch across them; a pane takes two pointers at most.
 */
export function createPointerRouter<Pane extends string>() {
  const pointers = new Map<number, { pane: Pane; at: Point }>();
  return {
    /** False when the pane already has two pointers. */
    down(id: number, pane: Pane, at: Point): boolean {
      let inPane = 0;
      for (const p of pointers.values()) if (p.pane === pane) inPane++;
      if (inPane >= MAX_POINTERS_PER_PANE) return false;
      pointers.set(id, { pane, at });
      return true;
    },
    move(id: number, at: Point): { readonly pane: Pane; readonly gesture: Gesture } | null {
      const own = pointers.get(id);
      if (own === undefined) return null;
      const other = [...pointers].find(
        ([otherId, p]) => otherId !== id && p.pane === own.pane,
      )?.[1];
      pointers.set(id, { pane: own.pane, at });
      const gesture: Gesture =
        other === undefined
          ? { kind: 'drag', dx: at.x - own.at.x, dy: at.y - own.at.y }
          : { kind: 'pinch', from: [own.at, other.at], to: [at, other.at] };
      return { pane: own.pane, gesture };
    },
    up(id: number): void {
      pointers.delete(id);
    },
    clear(): void {
      pointers.clear();
    },
  };
}

const KEY_ZOOM = 1.25;
const KEY_STEP = (5 * Math.PI) / 180;

/**
 * Pans and zooms the top-down pane of the shared canvas, or in the outside view orbits, tilts and
 * zooms it: drag, pinch, wheel and keys. Controls and the HUD's buttons sit above the canvas, so
 * their gestures never reach it.
 */
export function createViewInput(surface: HTMLElement, opts: ViewInputOptions): ViewInput {
  const abort = new AbortController();
  const { signal } = abort;
  let mode = opts.mode;
  let view = DEFAULT_TOP_DOWN_VIEW;
  const router = createPointerRouter<'topDown'>();

  const context = (): ViewContext => {
    const { width, height } = opts.getRect();
    return { mode, width, height };
  };
  const commit = (next: TopDownView): void => {
    if (next.zoom === view.zoom && next.panX === view.panX && next.panY === view.panY) return;
    view = next;
    opts.onChange(view);
  };
  /** Position of an event in the pane's own px, wherever it happened. */
  const toPane = (e: { clientX: number; clientY: number }): Point => {
    const box = surface.getBoundingClientRect();
    const r = opts.getRect();
    return { x: e.clientX - box.left - r.x, y: e.clientY - box.top - r.y };
  };
  const inPane = (p: Point): boolean => {
    const { width, height } = opts.getRect();
    return p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height && width > 0 && height > 0;
  };
  const centre = (ctx: ViewContext): Point => ({ x: ctx.width / 2, y: ctx.height / 2 });

  surface.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const p = toPane(e);
      if (!inPane(p) || !router.down(e.pointerId, 'topDown', p)) return;
      surface.setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    { signal },
  );

  surface.addEventListener(
    'pointermove',
    (e) => {
      const ctx = context();
      const moved = router.move(e.pointerId, toPane(e));
      if (moved === null || ctx.width === 0 || ctx.height === 0) return;
      const { gesture } = moved;
      commit(
        gesture.kind === 'drag'
          ? panBy(view, gesture.dx, gesture.dy, ctx)
          : pinch(view, gesture.from, gesture.to, ctx),
      );
    },
    { signal },
  );

  const release = (e: PointerEvent): void => {
    router.up(e.pointerId);
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    surface.addEventListener(type, release, { signal });
  }

  surface.addEventListener(
    'wheel',
    (e) => {
      const p = toPane(e);
      if (!inPane(p)) return;
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
      const action = actionFor('view', e);
      const chase = mode === 'chase';
      if (action === 'zoomIn') commit(zoomAt(view, KEY_ZOOM, centre(ctx), ctx));
      else if (action === 'zoomOut') commit(zoomAt(view, 1 / KEY_ZOOM, centre(ctx), ctx));
      else if (action === 'resetView') commit(DEFAULT_TOP_DOWN_VIEW);
      else if (chase && action === 'orbitLeft')
        commit(clampView({ ...view, panX: view.panX - KEY_STEP }, ctx));
      else if (chase && action === 'orbitRight')
        commit(clampView({ ...view, panX: view.panX + KEY_STEP }, ctx));
      else if (chase && action === 'tiltUp')
        commit(clampView({ ...view, panY: view.panY + KEY_STEP }, ctx));
      else if (chase && action === 'tiltDown')
        commit(clampView({ ...view, panY: view.panY - KEY_STEP }, ctx));
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
      router.clear();
    },
  };
}
