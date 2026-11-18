import type { LegendBox, Rect, ViewMode, ViewRects } from '../contracts/render';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

const INSET = 16;
const LABEL_BLOCK = 30;
const STOP_BLOCK = 55;
const STOP_GAP = 8;
const MIRROR_GAP = 8;
const COCKPIT_LABEL = 32;
/** Per side, so the area grows by its square. */
const MIRROR_SCALE = 1.22;
/** Smallest mirror height; where even this cannot clear the controls, it wins. */
export const MIN_MIRROR_HEIGHT = 48;

/** Screen areas the display cuts into, in CSS px; read from `--safe-*` in tokens.css. */
export type Insets = {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
};

const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

export function readSafeInsets(): Insets {
  if (typeof document === 'undefined') return NO_INSETS;
  const style = getComputedStyle(document.documentElement);
  const px = (name: string): number => parseFloat(style.getPropertyValue(name)) || 0;
  return {
    top: px('--safe-top'),
    right: px('--safe-right'),
    bottom: px('--safe-bottom'),
    left: px('--safe-left'),
  };
}

const GEARS_WIDTH = 92.4;
const LEGEND_WIDTH = 176;
/** Below this the reset button, which hangs off the wheel's corner, would leave the screen. */
const MIN_NARROW_WHEEL = 148;

/** The steering wheel's size; mirrors `--ctl-wheel` in tokens.css. */
export function wheelSize(cssWidth: number, cssHeight: number, insets: Insets = NO_INSETS): number {
  const wheel = clamp(0.38 * Math.min(cssWidth, cssHeight), 160, 300);
  if (cssWidth < cssHeight) return wheel;
  const room = 0.6 * cssWidth - insets.left - 3 * INSET - GEARS_WIDTH - LEGEND_WIDTH;
  return Math.min(wheel, Math.max(MIN_NARROW_WHEEL, room));
}

/** Height the control columns occupy above the viewport bottom; mirrors controls.css (--ctl-wheel, --ctl-lever-height, --size-target). */
export function controlsHeight(
  cssWidth: number,
  cssHeight: number,
  insets: Insets = NO_INSETS,
): number {
  const vmin = Math.min(cssWidth, cssHeight);
  const base = INSET + insets.bottom;
  const steer = base + LABEL_BLOCK + wheelSize(cssWidth, cssHeight, insets) + 2;
  if (cssWidth >= cssHeight) return steer;
  const lever = clamp(0.24 * vmin, 160, 240) + 2;
  return Math.max(steer, base + STOP_BLOCK + STOP_GAP + LABEL_BLOCK + lever);
}

/** `legend` is the measured key legend: the mirrors stay above it where it reaches under them. */
export function computeViewports(
  cssWidth: number,
  cssHeight: number,
  mode: ViewMode,
  legend: LegendBox | null = null,
  insets: Insets = readSafeInsets(),
): ViewRects {
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
  const fullWidth = clamp(
    Math.round(MIRROR_SCALE * 0.15 * cockpit.width),
    Math.round(MIRROR_SCALE * 72),
    Math.round(MIRROR_SCALE * 200),
  );
  const wanted = Math.min(2 * fullWidth, Math.round(MIRROR_SCALE * 0.5 * cockpit.height));
  // Only a cockpit that starts at the screen's top edge sits under the display cut-out there.
  const top = cockpit.y === 0 ? insets.top : 0;
  const floor = cockpit.y + top + COCKPIT_LABEL;
  const left = cockpit.x + INSET + insets.left;
  const right =
    cockpit.x + cockpit.width - INSET - (cockpit.x + cockpit.width >= cssWidth ? insets.right : 0);
  const controls = controlsHeight(cssWidth, cssHeight, insets);
  const preferred = cockpit.y + top + Math.round(0.16 * cockpit.height);
  /** The largest mirror with its bottom `clear` above the viewport bottom and at most `maxWidth` wide. */
  const fit = (clear: number, maxWidth: number) => {
    const ceiling = cssHeight - clear - MIRROR_GAP;
    const y = Math.min(preferred, Math.max(floor, ceiling - wanted));
    let height = clamp(ceiling - y, MIN_MIRROR_HEIGHT, wanted);
    if ((fullWidth * height) / wanted > maxWidth) {
      height = Math.max(MIN_MIRROR_HEIGHT, Math.floor((maxWidth * wanted) / fullWidth));
    }
    return { y, width: Math.round((fullWidth * height) / wanted), height };
  };
  // The mirror only shrinks and moves inward from its full width, so that width is the worst case.
  const reachesLegend = legend !== null && legend.right > right - fullWidth;
  let mirror = fit(controls, fullWidth);
  if (legend !== null && reachesLegend) {
    // Either sit above the legend, or beside it where that leaves the larger mirror.
    const above = fit(Math.max(controls, legend.height), fullWidth);
    const beside = fit(controls, Math.max(0, right - legend.right));
    const fits = right - beside.width >= legend.right;
    mirror = !fits || above.width * above.height >= beside.width * beside.height ? above : beside;
  }
  const { y, width: mw, height: mh } = mirror;
  return {
    cockpit,
    mirrorLeft: { x: left, y, width: mw, height: mh },
    mirrorRight: { x: right - mw, y, width: mw, height: mh },
    topDown,
  };
}
