import type { Orientation, TopDownSplit } from '../contracts/render';
import { t } from '../i18n/i18n';
import type { HudAction } from './hud';

/** Key steps move the divider by this share of the screen. */
const SPLIT_STEP = 0.02;
const percent = (share: number): number => Math.round(share * 100);

export type SplitAction = Extract<HudAction, { type: 'split' | 'splitReset' }>;

export type SplitDividerElements = {
  /** Sizes the pane: a drag moves the share by its fraction of this element. */
  root: HTMLElement;
  split: HTMLElement;
  handle: HTMLElement;
  reset: HTMLButtonElement;
};

export type SplitDivider = {
  /** The replay's full-screen pane (`hasCockpit` false) has no divider. */
  set(split: TopDownSplit | null, hasCockpit: boolean): void;
  /** Drops a pending frame; the drag's own state dies with the handle. */
  dispose(): void;
};

type Drag = {
  pointer: number;
  orientation: Orientation;
  /** Pointer position along the drag axis, at the start and latest. */
  start: number;
  current: number;
  /** The share when the drag began, and the last one proposed. */
  share: number;
  sent: number;
  frame: number | null;
};

const along = (e: PointerEvent, orientation: Orientation): number =>
  orientation === 'landscape' ? e.clientX : e.clientY;

export function createSplitDivider(
  { root, split, handle, reset }: SplitDividerElements,
  { emit, signal }: { emit: (a: SplitAction) => void; signal: AbortSignal },
): SplitDivider {
  handle.setAttribute('aria-label', t('viewSize'));
  reset.title = `${t('resetViewSize')} (L)`;
  reset.setAttribute('aria-label', t('resetViewSize'));
  let state: TopDownSplit | null = null;
  let hasCockpit = false;
  let drag: Drag | null = null;
  let keyDirty = false;
  const propose = (orientation: Orientation, share: number, commit: boolean): void =>
    emit({ type: 'split', orientation, share, commit });
  const clampShare = (share: number): number =>
    state === null ? share : Math.min(state.max, Math.max(state.min, share));

  /** Ends the drag without a result: the share goes back to where it began, and nothing is stored. */
  const cancelDrag = (): void => {
    const d = drag;
    if (d === null) return;
    drag = null;
    if (d.frame !== null) cancelAnimationFrame(d.frame);
    try {
      if (handle.hasPointerCapture(d.pointer)) handle.releasePointerCapture(d.pointer);
    } catch {
      // The pointer is already gone.
    }
    handle.blur();
    // Not inline: this can run inside a layout, which a proposal would re-enter.
    if (d.sent !== d.share) queueMicrotask(() => propose(d.orientation, d.share, false));
  };
  /** The replay's full-screen pane has no divider, and a screen whose range is a single percent has nothing to drag. */
  const syncHidden = (): void => {
    const hide = !hasCockpit || state === null || percent(state.max) <= percent(state.min);
    if (split.hidden !== hide) split.hidden = hide;
    if (hide) cancelDrag();
  };
  /** One proposal per frame, however many moves came in. */
  const proposeDrag = (d: Drag): void => {
    d.frame = null;
    const extent = d.orientation === 'landscape' ? root.clientWidth : root.clientHeight;
    const moved = d.orientation === 'landscape' ? d.start - d.current : d.current - d.start;
    const next = clampShare(d.share + moved / extent);
    if (next === d.sent) return;
    d.sent = next;
    propose(d.orientation, next, false);
  };
  handle.addEventListener(
    'pointerdown',
    (e) => {
      if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) {
        // No focus from a right-click or a second finger: a focused divider would keep the arrow keys from steering.
        e.preventDefault();
        return;
      }
      if (state === null || drag !== null) return;
      try {
        handle.setPointerCapture(e.pointerId);
      } catch {
        return;
      }
      const { orientation, share } = state;
      const start = along(e, orientation);
      drag = {
        pointer: e.pointerId,
        orientation,
        start,
        current: start,
        share,
        sent: share,
        frame: null,
      };
    },
    { signal },
  );
  handle.addEventListener(
    'mousedown',
    (e) => {
      if (e.button !== 0) e.preventDefault();
    },
    { signal },
  );
  handle.addEventListener(
    'pointermove',
    (e) => {
      const d = drag;
      if (d === null || e.pointerId !== d.pointer) return;
      d.current = along(e, d.orientation);
      d.frame ??= requestAnimationFrame(() => proposeDrag(d));
    },
    { signal },
  );
  handle.addEventListener(
    'pointerup',
    (e) => {
      // A pointer-focused divider would keep the arrow keys from steering.
      handle.blur();
      const d = drag;
      if (d === null || e.pointerId !== d.pointer) return;
      drag = null;
      if (d.frame !== null) cancelAnimationFrame(d.frame);
      d.current = along(e, d.orientation);
      proposeDrag(d);
      // Only a drag that moved the divider is worth storing.
      if (d.sent !== d.share) propose(d.orientation, d.sent, true);
    },
    { signal },
  );
  handle.addEventListener(
    'pointercancel',
    (e) => {
      handle.blur();
      if (e.pointerId === drag?.pointer) cancelDrag();
    },
    { signal },
  );
  handle.addEventListener(
    'lostpointercapture',
    (e) => {
      if (e.pointerId === drag?.pointer) cancelDrag();
    },
    { signal },
  );
  /** Stores where a burst of key presses ended; the repeats of a held key only move the divider. */
  const commitKeys = (): void => {
    if (!keyDirty || state === null) return;
    keyDirty = false;
    propose(state.orientation, state.share, true);
  };
  handle.addEventListener(
    'keydown',
    (e) => {
      if (state === null || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') {
        handle.blur();
        return;
      }
      const { share, min, max, orientation } = state;
      const landscape = orientation === 'landscape';
      let next: number | null = null;
      if (e.key === (landscape ? 'ArrowLeft' : 'ArrowDown')) next = share + SPLIT_STEP;
      else if (e.key === (landscape ? 'ArrowRight' : 'ArrowUp')) next = share - SPLIT_STEP;
      else if (e.key === 'Home') next = min;
      else if (e.key === 'End') next = max;
      // The other axis's arrows stay with the steering and the lever.
      if (next === null) return;
      e.preventDefault();
      e.stopPropagation();
      const clamped = clampShare(next);
      if (clamped === share) return;
      keyDirty = e.repeat;
      propose(orientation, clamped, !e.repeat);
    },
    { signal },
  );
  handle.addEventListener('keyup', commitKeys, { signal });
  handle.addEventListener('blur', commitKeys, { signal });
  reset.addEventListener('click', () => emit({ type: 'splitReset' }), { signal });

  return {
    set(next, cockpit) {
      hasCockpit = cockpit;
      if (next !== state) {
        if (next !== null && drag !== null && drag.orientation !== next.orientation) cancelDrag();
        state = next;
        if (next !== null) {
          const vertical = next.orientation === 'landscape';
          handle.setAttribute(
            'aria-keyshortcuts',
            vertical ? 'ArrowLeft ArrowRight Home End' : 'ArrowUp ArrowDown Home End',
          );
          handle.setAttribute('aria-orientation', vertical ? 'vertical' : 'horizontal');
          handle.setAttribute('aria-valuemin', String(percent(next.min)));
          handle.setAttribute('aria-valuemax', String(percent(next.max)));
          handle.setAttribute('aria-valuenow', String(percent(next.share)));
          handle.setAttribute('aria-valuetext', `${percent(next.share)} %`);
          const atDefault = Math.abs(next.share - next.fallback) < 1e-4;
          if (reset.disabled !== atDefault) reset.disabled = atDefault;
        }
      }
      syncHidden();
    },
    dispose() {
      if (drag?.frame != null) cancelAnimationFrame(drag.frame);
    },
  };
}
