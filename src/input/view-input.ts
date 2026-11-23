import {
  DEFAULT_TOP_DOWN_VIEW,
  HEAD_REST,
  type HeadPose,
  type Rect,
  type TopDownMode,
  type TopDownView,
} from '../contracts/render';
import { DRAG_SLOP_PX, dragHead, easeHead, glanceTarget, sameHead } from '../render/head-look';
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

export type LookOptions = {
  /** The cockpit pane in the canvas's CSS px; null where there is none. */
  readonly getRect: () => Rect | null;
  /** False where the cockpit draws no interior asset: the head stays forward. */
  readonly enabled: boolean;
  readonly onChange: (head: HeadPose) => void;
};

export type ViewInput = {
  /** Switching mode, even to the current one, resets the view. */
  setMode(mode: TopDownMode): void;
  reset(): void;
  /** Re-clamps the view after the pane changed size. */
  relayout(): void;
  /** Advances the head's easing by a frame of `seconds`, paused or not. */
  step(seconds: number): void;
  dispose(): void;
};

export type ViewInputOptions = {
  readonly mode: TopDownMode;
  /** The top-down pane in the canvas's CSS px. */
  readonly getRect: () => Rect;
  readonly onChange: (view: TopDownView) => void;
  /** Absent means the cockpit does not look around. */
  readonly look?: LookOptions;
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
    paneOf(id: number): Pane | undefined {
      return pointers.get(id)?.pane;
    },
    count(pane: Pane): number {
      return [...pointers.values()].filter((p) => p.pane === pane).length;
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

type Pane = 'topDown' | 'cockpit';

/**
 * Pans and zooms the top-down pane of the shared canvas, or in the outside view orbits, tilts and
 * zooms it: drag, pinch, wheel and keys. A drag in the cockpit pane turns the head instead and the
 * glance keys hold it to a side; it eases back on release. Controls and the HUD's buttons sit above
 * the canvas, so their gestures never reach it.
 */
export function createViewInput(surface: HTMLElement, opts: ViewInputOptions): ViewInput {
  const abort = new AbortController();
  const { signal } = abort;
  let mode = opts.mode;
  let view = DEFAULT_TOP_DOWN_VIEW;
  const router = createPointerRouter<Pane>();

  const context = (): ViewContext => {
    const { width, height } = opts.getRect();
    return { mode, width, height };
  };
  const commit = (next: TopDownView): void => {
    if (next.zoom === view.zoom && next.panX === view.panX && next.panY === view.panY) return;
    view = next;
    opts.onChange(view);
  };
  const look = opts.look?.enabled === true ? opts.look : undefined;
  const rectOf = (pane: Pane): Rect | null =>
    pane === 'topDown' ? opts.getRect() : (look?.getRect() ?? null);
  /** Position of an event in `rect`'s own px, wherever it happened. */
  const toPane = (e: { clientX: number; clientY: number }, r: Rect = opts.getRect()): Point => {
    const box = surface.getBoundingClientRect();
    return { x: e.clientX - box.left - r.x, y: e.clientY - box.top - r.y };
  };
  const inRect = (p: Point, { width, height }: Rect): boolean =>
    p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height && width > 0 && height > 0;
  const inPane = (p: Point): boolean => inRect(p, opts.getRect());
  const centre = (ctx: ViewContext): Point => ({ x: ctx.width / 2, y: ctx.height / 2 });

  let head = HEAD_REST;
  const glance = { left: false, right: false };
  /** A cockpit drag's travel while under the slop; once past it the drag turns the head. */
  let slop = { x: 0, y: 0, past: false };
  const turn = (next: HeadPose): void => {
    if (sameHead(next, head)) return;
    head = next;
    look?.onChange(head);
  };

  surface.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const p = toPane(e);
      const cockpit = look?.getRect() ?? null;
      let pane: Pane = 'topDown';
      let at = p;
      if (!inPane(p)) {
        if (cockpit === null) return;
        at = toPane(e, cockpit);
        if (!inRect(at, cockpit)) return;
        pane = 'cockpit';
      }
      if (!router.down(e.pointerId, pane, at)) return;
      if (pane === 'cockpit' && router.count('cockpit') === 1) slop = { x: 0, y: 0, past: false };
      surface.setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    { signal },
  );

  surface.addEventListener(
    'pointermove',
    (e) => {
      const pane = router.paneOf(e.pointerId);
      const rect = pane === undefined ? null : rectOf(pane);
      if (pane === undefined || rect === null || rect.width === 0 || rect.height === 0) return;
      const moved = router.move(e.pointerId, toPane(e, rect));
      if (moved === null) return;
      const { gesture } = moved;
      if (pane === 'cockpit') {
        // one finger or the mouse turns the head; a second finger does nothing, as the field of view is fixed
        if (gesture.kind !== 'drag') return;
        if (slop.past) {
          turn(dragHead(head, gesture.dx, gesture.dy, rect.height));
        } else {
          const x = slop.x + gesture.dx;
          const y = slop.y + gesture.dy;
          slop = { x, y, past: Math.hypot(x, y) >= DRAG_SLOP_PX };
        }
        return;
      }
      const ctx = context();
      commit(
        gesture.kind === 'drag'
          ? panBy(view, gesture.dx, gesture.dy, ctx)
          : pinch(view, gesture.from, gesture.to, ctx),
      );
    },
    { signal },
  );

  const release = (e: PointerEvent): void => {
    const pane = router.paneOf(e.pointerId);
    router.up(e.pointerId);
    if (pane !== 'cockpit') return;
    if (router.count('cockpit') === 0) slop = { x: 0, y: 0, past: false };
    // the Android back gesture cancels the pointer: leave the look at once instead of easing
    if (e.type === 'pointercancel') turn(HEAD_REST);
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
      else if (look !== undefined && action === 'glanceLeft') glance.left = true;
      else if (look !== undefined && action === 'glanceRight') glance.right = true;
      else return;
      e.preventDefault();
    },
    { signal },
  );

  const letGo = (e: KeyboardEvent): void => {
    const action = actionFor('view', e);
    if (action === 'glanceLeft') glance.left = false;
    else if (action === 'glanceRight') glance.right = false;
  };
  const letGoAll = (): void => {
    glance.left = false;
    glance.right = false;
  };
  window.addEventListener('keyup', letGo, { signal });
  window.addEventListener('blur', letGoAll, { signal });

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
    step(seconds) {
      // a drag holds the head where the pointer put it
      if (look === undefined || slop.past) return;
      turn(easeHead(head, glanceTarget(glance.left, glance.right), seconds));
    },
    dispose() {
      abort.abort();
      router.clear();
    },
  };
}
