import type { Rect, ViewMode, ViewRects } from '../contracts/render';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function computeViewports(cssWidth: number, cssHeight: number, mode: ViewMode): ViewRects {
  if (mode === 'replay') {
    const full: Rect = { x: 0, y: 0, width: cssWidth, height: cssHeight };
    return { cockpit: null, mirrorLeft: null, mirrorRight: null, topDown: full };
  }
  let topDown: Rect;
  let cockpit: Rect;
  if (cssWidth >= cssHeight) {
    const w = Math.round(0.4 * cssWidth);
    topDown = { x: 0, y: 0, width: w, height: cssHeight };
    cockpit = { x: w, y: 0, width: cssWidth - w, height: cssHeight };
  } else {
    const h = cssHeight - Math.round(0.55 * cssHeight);
    topDown = { x: 0, y: 0, width: cssWidth, height: h };
    cockpit = { x: 0, y: h, width: cssWidth, height: cssHeight - h };
  }
  const mw = clamp(Math.round(0.15 * cockpit.width), 72, 200);
  const mh = Math.min(2 * mw, Math.round(0.5 * cockpit.height));
  const y = cockpit.y + Math.round(0.16 * cockpit.height);
  return {
    cockpit,
    mirrorLeft: { x: cockpit.x + 16, y, width: mw, height: mh },
    mirrorRight: { x: cockpit.x + cockpit.width - 16 - mw, y, width: mw, height: mh },
    topDown,
  };
}
