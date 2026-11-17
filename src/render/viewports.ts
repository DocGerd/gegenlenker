import type { Rect, ViewMode, ViewRects } from '../contracts/render';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

const INSET = 16;
const LABEL_BLOCK = 30;
const STOP_BLOCK = 55;
const STOP_GAP = 8;
const MIRROR_GAP = 8;
const COCKPIT_LABEL = 32;
/** Smallest mirror height; where even this cannot clear the controls, it wins. */
export const MIN_MIRROR_HEIGHT = 48;

/** Height the control columns occupy above the viewport bottom; mirrors controls.css (--ctl-wheel, --ctl-lever-height, --size-target). */
export function controlsHeight(cssWidth: number, cssHeight: number): number {
  const vmin = Math.min(cssWidth, cssHeight);
  const steer = INSET + LABEL_BLOCK + clamp(0.38 * vmin, 160, 300) + 2;
  if (cssWidth >= cssHeight) return steer;
  const lever = clamp(0.24 * vmin, 160, 240) + 2;
  return Math.max(steer, INSET + STOP_BLOCK + STOP_GAP + LABEL_BLOCK + lever);
}

export function computeViewports(cssWidth: number, cssHeight: number, mode: ViewMode): ViewRects {
  if (mode === 'replay') {
    const full: Rect = { x: 0, y: 0, width: cssWidth, height: cssHeight };
    return { cockpit: null, mirrorLeft: null, mirrorRight: null, topDown: full };
  }
  let topDown: Rect;
  let cockpit: Rect;
  if (cssWidth >= cssHeight) {
    const w = Math.round(0.4 * cssWidth);
    topDown = { x: cssWidth - w, y: 0, width: w, height: cssHeight };
    cockpit = { x: 0, y: 0, width: cssWidth - w, height: cssHeight };
  } else {
    const h = cssHeight - Math.round(0.55 * cssHeight);
    topDown = { x: 0, y: 0, width: cssWidth, height: h };
    cockpit = { x: 0, y: h, width: cssWidth, height: cssHeight - h };
  }
  const fullWidth = clamp(Math.round(0.15 * cockpit.width), 72, 200);
  const wanted = Math.min(2 * fullWidth, Math.round(0.5 * cockpit.height));
  const floor = cockpit.y + COCKPIT_LABEL;
  const ceiling = cssHeight - controlsHeight(cssWidth, cssHeight) - MIRROR_GAP;
  const preferred = cockpit.y + Math.round(0.16 * cockpit.height);
  const y = Math.min(preferred, Math.max(floor, ceiling - wanted));
  const mh = clamp(ceiling - y, MIN_MIRROR_HEIGHT, wanted);
  const mw = Math.round((fullWidth * mh) / wanted);
  return {
    cockpit,
    mirrorLeft: { x: cockpit.x + INSET, y, width: mw, height: mh },
    mirrorRight: { x: cockpit.x + cockpit.width - INSET - mw, y, width: mw, height: mh },
    topDown,
  };
}
