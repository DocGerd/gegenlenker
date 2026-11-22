import {
  DEFAULT_TOP_DOWN_LAYOUT,
  type ExtraMirrors,
  NO_EXTRA_MIRRORS,
  TOP_DOWN_SHARE_LIMITS,
  type LegendBox,
  type Orientation,
  type Rect,
  type TopDownLayout,
  type TopDownSplit,
  type ViewMode,
  type ViewRects,
} from '../contracts/render';
import { COCKPIT_FOV, coneEdge, coneTop, frontBand } from './cockpit-band';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

const INSET = 16;
const LABEL_BLOCK = 30;
const STOP_BLOCK = 55;
const STOP_GAP = 8;
const MIRROR_GAP = 8;
const COCKPIT_LABEL = 32;
/** Per side, so the area grows by its square. */
const MIRROR_SCALE = 1.22;
/** The opaque HUD band's share of the cockpit height; mirrors `--hud-band` in hud.css. */
export const HUD_BAND_SHARE = 0.18;
/** The band's top edge as NDC y of the cockpit view: nothing a trainee must see lies below it. */
export const bandTopNdc = (): number => 2 * HUD_BAND_SHARE - 1;
/** Smallest mirror height; where even this cannot clear the controls, it wins. */
export const MIN_MIRROR_HEIGHT = 48;
/** Narrowest and widest the front mirror gets, in CSS px; where the band cannot hold the narrowest, there is none. */
export const MIN_FRONT_WIDTH = 80;
const MAX_FRONT_WIDTH = 240;
/** CSS px between the toast column and the mirrors on either side of it. */
const MESSAGE_GAP = 8;
/**
 * Narrowest toast column: the widest unbreakable word of a toast or goal cue ("Drehschemelwinkel",
 * 131 px at 14 px Geist, measured), the toast's padding and borders (41 px, warn border included)
 * and the 32 px its `max-width` leaves. `viewports.test.ts` pins the word, `layout.spec.ts` the fit.
 */
export const MIN_MESSAGE_WIDTH = 131 + 41 + 32;
/**
 * What the toast and the goal cue stack needs, for the longest messages ("Drehschemelwinkel am
 * Anschlag – in Gegenrichtung fahren", "In der Toleranz – jetzt anhalten"): characters, an
 * over-estimated px per character, line height, and the padding and border above and below a box.
 */
const TOAST_CHARS = 56;
const CUE_CHARS = 33;
const CHAR_PX = 7.5;
const MESSAGE_LINE = 22;
const MESSAGE_BOX = 18;
/** Height of the gear column with its lamp row, as `layout.spec.ts` measures it. */
const GEARS_HEIGHT = 274.5;
/** The front mirror's width over its height. */
export const FRONT_ASPECT = 2;

/** Screen areas the display cuts into, in CSS px; read from `--safe-*` in tokens.css. */
export type Insets = {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
};

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

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

/** The bottom edge of the top view's HUD panels, px below the pane's top, were the pane `paneWidth` wide. */
export type PanelStack = (paneWidth: number) => number;

/** A px custom property of the root element; `fallback` outside a document. */
function tokenPx(name: string, fallback: number): number {
  if (typeof document === 'undefined') return fallback;
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || fallback;
}

/**
 * What the divider takes along the pane's edge (and a gap to the panels above it); mirrors `.hud-split`
 * in hud.css: landscape the handle, the reset button, their gap and the pane's bottom padding;
 * portrait only the handle row, flush with the pane's bottom.
 */
function dividerExtent(orientation: Orientation, insets: Insets): number {
  const target = tokenPx('--size-target', 44);
  const gap = tokenPx('--space-2', 8);
  if (orientation === 'portrait') return target + gap;
  return 3 * target + 2 * gap + tokenPx('--space-4', INSET) + insets.bottom;
}

export const orientationOf = (cssWidth: number, cssHeight: number): Orientation =>
  cssWidth >= cssHeight ? 'landscape' : 'portrait';

/**
 * The top-down share in use. It may not take the cockpit below what its controls need: in landscape
 * the wheel, gears and compact legend side by side, in portrait the controls plus the smallest
 * mirror above them; nor the top view below what its panels and the divider need (`panels`).
 * The default always stays allowed. Where it leaves no room for the divider, `min` and `max`
 * both equal the default.
 */
export function topDownSplit(
  cssWidth: number,
  cssHeight: number,
  layout: TopDownLayout = DEFAULT_TOP_DOWN_LAYOUT,
  legend: LegendBox | null = null,
  safeInsets?: Insets,
  panels: PanelStack | null = null,
): TopDownSplit {
  const insets = safeInsets ?? readSafeInsets();
  const orientation = orientationOf(cssWidth, cssHeight);
  const landscape = orientation === 'landscape';
  const fallback = DEFAULT_TOP_DOWN_LAYOUT[orientation];
  const limits = TOP_DOWN_SHARE_LIMITS[orientation];
  const extent = landscape ? cssWidth : cssHeight;
  const cockpitNeeded = landscape
    ? insets.left + 3 * INSET + GEARS_WIDTH + LEGEND_WIDTH + wheelSize(cssWidth, cssHeight, insets)
    : COCKPIT_LABEL +
      MIN_MIRROR_HEIGHT +
      MIRROR_GAP +
      Math.max(controlsHeight(cssWidth, cssHeight, insets), legend?.height ?? 0);
  const max = Math.min(limits.max, Math.max(fallback, 1 - cockpitNeeded / extent));
  const divider = dividerExtent(orientation, insets);
  // Landscape the panels wrap with the pane's width, so a wider pane is what makes room; portrait the
  // width is fixed and the pane's height must hold the panels.
  const fits = (pane: number): boolean =>
    panels === null ||
    (landscape ? panels(pane) + divider <= cssHeight : panels(cssWidth) + divider <= pane);
  let hi = fallback * extent;
  if (!fits(hi)) return { orientation, share: fallback, min: fallback, max: fallback, fallback };
  let lo = limits.min * extent;
  if (fits(lo)) hi = lo;
  else if (landscape) {
    while (hi - lo > 1) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
  } else if (panels !== null) hi = panels(cssWidth) + divider;
  const min = Math.min(fallback, Math.max(limits.min, hi / extent));
  return { orientation, share: clamp(layout[orientation], min, max), min, max, fallback };
}

/** `legend` is the measured key legend: the mirrors stay above it where it reaches under them. */
export function computeViewports(
  cssWidth: number,
  cssHeight: number,
  mode: ViewMode,
  legend: LegendBox | null = null,
  safeInsets?: Insets,
  layout: TopDownLayout = DEFAULT_TOP_DOWN_LAYOUT,
  panels: PanelStack | null = null,
  extra: ExtraMirrors = NO_EXTRA_MIRRORS,
): ViewRects {
  if (mode === 'replay') {
    const full: Rect = { x: 0, y: 0, width: cssWidth, height: cssHeight };
    return { cockpit: null, mirrorLeft: null, mirrorRight: null, front: null, topDown: full };
  }
  const insets = safeInsets ?? readSafeInsets();
  const { share } = topDownSplit(cssWidth, cssHeight, layout, legend, insets, panels);
  let topDown: Rect;
  let cockpit: Rect;
  if (cssWidth >= cssHeight) {
    const w = Math.round(share * cssWidth);
    topDown = { x: cssWidth - w, y: 0, width: w, height: cssHeight };
    cockpit = { x: 0, y: 0, width: cssWidth - w, height: cssHeight };
  } else {
    const h = cssHeight - Math.round((1 - share) * cssHeight);
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
  const mirrorRight: Rect = { x: right - mw, y, width: mw, height: mh };
  const messagesLeft = left + mw + MESSAGE_GAP;
  let front: Rect | null = null;
  if (extra.front) {
    // the toast column left of it starts right of the left mirror
    const leftLimit = messagesLeft + insets.left + MIN_MESSAGE_WIDTH + MESSAGE_GAP;
    front = frontRect(
      cockpit,
      mirrorRight,
      leftLimit,
      cockpit.y + top,
      cssHeight,
      controls,
      legend,
    );
    if (front !== null) {
      const column = { x: messagesLeft, width: front.x - MESSAGE_GAP - messagesLeft };
      if (!messagesFit(cockpit, column, cssWidth, cssHeight, controls, insets)) front = null;
    }
  }
  return {
    cockpit,
    mirrorLeft: { x: left, y, width: mw, height: mh },
    mirrorRight,
    front,
    topDown,
  };
}

/**
 * Whether the longest toast and the goal cue, stacked in `column` from the cockpit's top, end above
 * the controls and the forward sight cone they would otherwise reach into.
 */
function messagesFit(
  cockpit: Rect,
  column: { readonly x: number; readonly width: number },
  cssWidth: number,
  cssHeight: number,
  controls: number,
  insets: Insets,
): boolean {
  const lines = (chars: number, chrome: number): number =>
    Math.ceil((chars * CHAR_PX) / Math.max(1, column.width - insets.left - chrome));
  // the toast's max-width leaves 32 px, its padding and borders take 41; the cue has no such margin
  const toast = lines(TOAST_CHARS, 32 + 41) * MESSAGE_LINE + MESSAGE_BOX;
  const cue = lines(CUE_CHARS, 34) * MESSAGE_LINE + MESSAGE_BOX;
  const landscape = cssWidth >= cssHeight;
  const bottom = cockpit.y + INSET + (landscape ? insets.top : 0) + toast + MESSAGE_GAP + cue;
  const reaches = (x0: number, x1: number): boolean =>
    column.x < x1 && column.x + column.width > x0;
  const wheel = wheelSize(cssWidth, cssHeight, insets);
  const gearsLeft = 2 * INSET + wheel + insets.left;
  if (reaches(INSET + insets.left, gearsLeft + GEARS_WIDTH)) {
    const gearsTop = cssHeight - INSET - insets.bottom - GEARS_HEIGHT;
    if (bottom > Math.min(cssHeight - controls, gearsTop)) return false;
  }
  const half = (coneEdge(cockpit.width / cockpit.height, COCKPIT_FOV) * cockpit.width) / 2;
  const centre = cockpit.x + cockpit.width / 2;
  const coneTopY = cockpit.y + ((1 - coneTop(COCKPIT_FOV)) / 2) * cockpit.height;
  return !(reaches(centre - half, centre + half) && bottom > coneTopY);
}

/**
 * The front mirror in the windscreen band of `cockpit` (`frontBand`), hung from the header at the
 * band's right; null where it would be narrower than `MIN_FRONT_WIDTH` or would reach the controls or
 * the key legend. `leftLimit` is the least x it may start at, which keeps the toast column wide
 * enough; `ceiling` is the least y the screen's display cut-out leaves.
 */
function frontRect(
  cockpit: Rect,
  mirrorRight: Rect,
  leftLimit: number,
  ceiling: number,
  cssHeight: number,
  controls: number,
  legend: LegendBox | null,
): Rect | null {
  const band = frontBand(
    cockpit.width / cockpit.height,
    (2 * (mirrorRight.x - cockpit.x)) / cockpit.width - 1,
    cockpit.width,
  );
  if (band === null) return null;
  const toX = (ndc: number): number => cockpit.x + ((ndc + 1) / 2) * cockpit.width;
  const toY = (ndc: number): number => cockpit.y + ((1 - ndc) / 2) * cockpit.height;
  const top = Math.ceil(Math.max(toY(band.top), ceiling));
  const right = Math.floor(toX(band.right));
  const height = Math.floor(
    Math.min(
      toY(band.bottom) - top,
      (right - Math.max(toX(band.left), leftLimit)) / FRONT_ASPECT,
      MAX_FRONT_WIDTH / FRONT_ASPECT,
    ),
  );
  const width = FRONT_ASPECT * height;
  if (width < MIN_FRONT_WIDTH) return null;
  const rect = { x: right - width, y: top, width, height };
  const bottom = rect.y + rect.height + MIRROR_GAP;
  if (bottom > cssHeight - controls) return null;
  if (legend !== null && legend.right > rect.x && bottom > cssHeight - legend.height) return null;
  return rect;
}

/** Where the toast and the goal cue stand: the cockpit's top, between the left mirror and the front mirror. */
export function messageColumn(views: ViewRects): Rect {
  const base = views.cockpit ?? views.topDown;
  const { front, mirrorLeft } = views;
  if (front === null || mirrorLeft === null) return base;
  const x = mirrorLeft.x + mirrorLeft.width + MESSAGE_GAP;
  return { ...base, x, width: front.x - MESSAGE_GAP - x };
}
