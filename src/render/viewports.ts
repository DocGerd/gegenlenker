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
import type { Role } from '../contracts/exercise';
import { de } from '../i18n/de';
import { en, type MessageKey } from '../i18n/en';
import { COCKPIT_FOV, coneEdge, coneTop, frontBand } from './cockpit-band';
import { FRONT_ASPECT, WIDE_ASPECT } from '../vehicles/mirrors';
import { CLOSE_ASPECT, MIN_CLOSE_WIDTH } from './close-mirror';

export { FRONT_ASPECT, WIDE_ASPECT } from '../vehicles/mirrors';

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
/** How far `.hud-legend` stands above the HUD band (hud.css). */
const LEGEND_LIFT = 12;
/** The band's top edge as NDC y of the cockpit view: nothing a trainee must see lies below it. */
export const bandTopNdc = (): number => 2 * HUD_BAND_SHARE - 1;
/** Smallest mirror height; where the room above the controls and `MIRROR_GAP` is smaller, class II shrinks to that room. */
export const MIN_MIRROR_HEIGHT = 48;
/**
 * The least class II shrinks to, for a window with no room left: the least height whose width still
 * rounds to a whole px (`wanted` is at most twice `fullWidth`). Only there does the mirror reach into
 * `MIRROR_GAP` and the controls.
 */
export const MIN_SQUEEZED_HEIGHT = 1;
/**
 * Narrowest and widest the front mirror gets, in CSS px. The narrowest is wide enough that a 0.3 m
 * cone base spans 6 px anywhere in the class VI field (`front-mirror.test.ts` derives it from the
 * camera); where the band cannot hold it, there is no front mirror.
 */
export const MIN_FRONT_WIDTH = 122;
const MAX_FRONT_WIDTH = 240;
/** CSS px between the toast column and the mirrors on either side of it. */
export const MESSAGE_GAP = 8;
/**
 * Narrowest toast column: the widest unbreakable word of a toast or goal cue ("Gegenrichtung", 99 px
 * at 14 px Geist, measured; the longer compounds break at their soft hyphen), the toast's padding and
 * borders (41 px, warn border included) and the 32 px its `max-width` leaves. `viewports.test.ts` pins
 * the word, `layout.spec.ts` the fit.
 */
export const MIN_MESSAGE_WIDTH = 99 + 41 + 32;
/**
 * The toast and goal-cue messages `messagesFit` wraps. `viewports.test.ts` checks the lists against
 * the message tables.
 */
export const MESSAGE_KEYS = {
  toast: [
    'contactAhead',
    'limitAhead',
    'selectGear',
    'blockedContactTruck',
    'blockedContactDrawbar',
    'blockedContactTrailer',
    'blockedContactSelf',
    'blockedCoupling',
    'blockedTurntable',
    'blockedContactTruckGuide',
    'blockedContactDrawbarGuide',
    'blockedContactTrailerGuide',
    'blockedContactSelfGuide',
    'blockedCouplingGuide',
    'blockedTurntableGuide',
  ],
  cue: ['goalInside', 'goalDistance', 'goalAngleOk', 'goalAngleOff', 'goalPositionOk'],
  /** The Einweiser's sight cue (`sightCueBox`), not part of the stack. */
  sight: [
    'sightDirect',
    'sightMirrorLeft',
    'sightMirrorRight',
    'sightWideLeft',
    'sightWideRight',
    'sightClose',
    'sightFront',
    'sightNone',
    'sightUnclear',
  ],
} as const satisfies Record<string, readonly MessageKey[]>;
/** The sight cue's width, `--hud-sight-w` in hud.css. */
export const SIGHT_CUE_WIDTH = 240;
/** What the sight cue's text leaves of its width: padding and borders, the eye icon and its gap (`.hud-sight`). */
const SIGHT_CUE_CHROME = 62;
/** Where a word may break, showing a hyphen (`wrapLines`). */
export const SOFT_HYPHEN = '\u00AD';
/**
 * A word's width at 14 px Geist, medium: no less than any measured word of these messages has
 * (`MESSAGE_WORD_PX` in `viewports.test.ts` holds the measurements), and its space.
 */
export const wordPx = (word: string): number => 8 * word.replaceAll(SOFT_HYPHEN, '').length + 6;
export const SPACE_PX = 4;
const MESSAGE_LINE = 22;
const MESSAGE_BOX = 18;
/** Height of the gear column with its lamp row, as `layout.spec.ts` measures it. */
const GEARS_HEIGHT = 274.5;
/** CSS px between a class II mirror and the class IV mirror under it: both HUD frames (6 px each) and a margin. */
export const WIDE_GAP_PX = 16;
/**
 * Narrowest the class IV mirror (and so the class II above it) gets, in CSS px: a 0.5 m wide road
 * user spans 2 texels across the line of sight anywhere in the 4.5 m strip beside the truck, at the
 * mirror's render scale and a device pixel ratio of 1 (`wide-mirror.test.ts` derives it from the
 * camera). Where the column cannot hold it, there is no class IV mirror.
 */
export const MIN_WIDE_WIDTH = 96;
/**
 * Class II never drops below this share of the linear size it has without class IV and the sight cone;
 * below it class IV is dropped. Low enough to show class IV on the laptop viewports `viewports.test.ts` lists.
 */
export const MIN_CLASS_II_SHARE = 0.72;
/** The class IV mirror's height at `width`. */
export const wideHeight = (width: number): number => Math.round(width / WIDE_ASPECT);
/** The least height of a class IV mirror: that of the narrowest. */
export const MIN_WIDE_HEIGHT = wideHeight(MIN_WIDE_WIDTH);

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

/** What the landscape pane's message column leaves at the screen's right edge, for the stop button and lever. */
function paneLever(insets: Insets): number {
  return 1.5 * tokenPx('--size-target', 44) + INSET + insets.right + MESSAGE_GAP;
}

/**
 * The key legend as `hud.legendBox()` measures it. It stands on the HUD band, a share of the cockpit,
 * so `height` holds only at the split it was measured at; `boxHeight`, its own height, at every split.
 * Without `boxHeight` the legend is taken as fixed on screen. `states` holds its own height in a cockpit
 * shorter than `below` px and in a taller one, where hud.ts changes what it lists; without it, `boxHeight` holds for both.
 */
export type MeasuredLegend = LegendBox & {
  readonly boxHeight?: number;
  readonly states?: { readonly below: number; readonly short: number; readonly tall: number };
};

/** The inputs of `topDownSplit`. */
export interface SplitOptions {
  /** The stored share (default `DEFAULT_TOP_DOWN_LAYOUT`). */
  readonly layout?: TopDownLayout | undefined;
  /** The measured key legend. */
  readonly legend?: MeasuredLegend | null | undefined;
  /** The safe-area insets (default: read from the CSS tokens). */
  readonly insets?: Insets | undefined;
  /** The measured panel stack above the divider. */
  readonly panels?: PanelStack | null | undefined;
}

/** The inputs of `computeViewports`; `mode` is required. */
export interface ViewportOptions extends SplitOptions {
  readonly mode: ViewMode | 'mirrors';
  readonly extra?: ExtraMirrors | undefined;
  readonly role?: Role | undefined;
}

/**
 * The top-down share in use. It may not take the cockpit below what its controls need: in landscape
 * the wheel, gears and compact legend side by side, in portrait the controls plus the smallest
 * mirror above them; nor the top view below what its panels and the divider need (`panels`), nor,
 * in landscape and short of the default and the cockpit's need, below a `MIN_MESSAGE_WIDTH` column.
 * The default always stays allowed. Where it leaves no room for the divider, `min` and `max`
 * both equal the default.
 */
export function topDownSplit(
  cssWidth: number,
  cssHeight: number,
  {
    layout = DEFAULT_TOP_DOWN_LAYOUT,
    legend = null,
    insets: safeInsets,
    panels = null,
  }: SplitOptions = {},
): TopDownSplit {
  const insets = safeInsets ?? readSafeInsets();
  const orientation = orientationOf(cssWidth, cssHeight);
  const landscape = orientation === 'landscape';
  const fallback = DEFAULT_TOP_DOWN_LAYOUT[orientation];
  const limits = TOP_DOWN_SHARE_LIMITS[orientation];
  const extent = landscape ? cssWidth : cssHeight;
  const aboveControls = COCKPIT_LABEL + MIN_MIRROR_HEIGHT + MIRROR_GAP;
  // The band, and the legend on it, rise with the cockpit's height: solved for that height, so the
  // range does not move with the share the legend was measured at.
  const portraitNeeded = (): number => {
    const controls = aboveControls + controlsHeight(cssWidth, cssHeight, insets);
    if (legend === null) return controls;
    if (legend.boxHeight === undefined) return Math.max(controls, aboveControls + legend.height);
    const holding = (boxHeight: number): number =>
      Math.max(controls, (aboveControls + LEGEND_LIFT + boxHeight) / (1 - HUD_BAND_SHARE));
    const { states } = legend;
    if (states === undefined) return holding(legend.boxHeight);
    // each state on its side of `below`, so the range does not move with the state measured either;
    // the short state's need only where the full list also fits every cockpit from `below` up
    const short = Math.ceil(holding(states.short));
    const tall = holding(states.tall);
    return short < states.below && tall <= states.below ? short : Math.max(states.below, tall);
  };
  const cockpitNeeded = landscape
    ? insets.left + 3 * INSET + GEARS_WIDTH + LEGEND_WIDTH + wheelSize(cssWidth, cssHeight, insets)
    : portraitNeeded();
  // The cockpit is whole px (`computeViewports` rounds the pane), so it keeps the need only when rounded up.
  const max = Math.min(limits.max, Math.max(fallback, 1 - Math.ceil(cockpitNeeded) / extent));
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
  const messages = landscape
    ? Math.min(Math.ceil(MIN_MESSAGE_WIDTH + paneLever(insets)), extent - Math.ceil(cockpitNeeded))
    : 0;
  const min = Math.min(fallback, Math.max(limits.min, hi / extent, messages / extent));
  return { orientation, share: clamp(layout[orientation], min, max), min, max, fallback };
}

/** Where the drive screen has no top-down view, which is then a zero-width rect at the screen's right edge. */
export const hasTopDown = (views: ViewRects): boolean =>
  views.topDown.width > 0 && views.topDown.height > 0;

/**
 * `mirrors` is the drive screen without the top-down view: the cockpit takes the whole window.
 * `legend` is the measured key legend: the mirrors stay above it where it reaches under them.
 * In the `einweiser` role the cockpit rect is his first-person view, split from the top view as the
 * driver's is, with no mirrors (`docs/einweiser-spike.md` §3.7).
 */
export function computeViewports(
  cssWidth: number,
  cssHeight: number,
  options: ViewportOptions,
): ViewRects {
  const {
    mode,
    legend = null,
    insets: safeInsets,
    layout = DEFAULT_TOP_DOWN_LAYOUT,
    panels = null,
    extra = NO_EXTRA_MIRRORS,
    role = 'driver',
  } = options;
  if (mode === 'replay') {
    const full: Rect = { x: 0, y: 0, width: cssWidth, height: cssHeight };
    return {
      cockpit: null,
      mirrorLeft: null,
      mirrorRight: null,
      wideLeft: null,
      wideRight: null,
      front: null,
      close: null,
      topDown: full,
    };
  }
  const insets = safeInsets ?? readSafeInsets();
  const mirrorsOnly = mode === 'mirrors';
  const { share, min } = mirrorsOnly
    ? { share: 0, min: 0 }
    : topDownSplit(cssWidth, cssHeight, { layout, legend, insets, panels });
  let topDown: Rect;
  let cockpit: Rect;
  /** Portrait, how many px the cockpit's top can still rise as the share shrinks to its minimum. */
  let rise = 0;
  if (mirrorsOnly) {
    topDown = { x: cssWidth, y: 0, width: 0, height: cssHeight };
    cockpit = { x: 0, y: 0, width: cssWidth, height: cssHeight };
  } else if (cssWidth >= cssHeight) {
    const w = Math.round(share * cssWidth);
    topDown = { x: cssWidth - w, y: 0, width: w, height: cssHeight };
    cockpit = { x: 0, y: 0, width: cssWidth - w, height: cssHeight };
  } else {
    const paneHeight = (s: number): number => cssHeight - Math.round((1 - s) * cssHeight);
    const h = paneHeight(share);
    topDown = { x: 0, y: 0, width: cssWidth, height: h };
    cockpit = { x: 0, y: h, width: cssWidth, height: cssHeight - h };
    rise = h - paneHeight(min);
  }
  if (role === 'einweiser') {
    return {
      cockpit,
      mirrorLeft: null,
      mirrorRight: null,
      wideLeft: null,
      wideRight: null,
      front: null,
      close: null,
      topDown,
    };
  }
  const room = { cssWidth, cssHeight, mirrorsOnly, legend, insets, extra };
  let placed = placeMirrors({ ...room, cockpit, rise });
  // A growing portrait pane shortens the cockpit and narrows class II, so the front mirror's room and
  // the wrap of the messages beside it come and go. It stays only where it also fits at every smaller
  // share the split can reach: as the share grows it then drops once, where it first stops fitting.
  for (let y = cockpit.y - rise; placed.front !== null && y < cockpit.y; y++) {
    const taller = { ...cockpit, y, height: cssHeight - y };
    if (placeMirrors({ ...room, cockpit: taller, rise: y - (cockpit.y - rise) }).front === null) {
      placed = placeMirrors({ ...room, cockpit, rise, extra: { ...extra, front: false } });
    }
  }
  const { mirror, mirrorRight, front, floor } = placed;
  const { y, width: mw, height: mh, wide } = mirror;
  const under = (rect: Rect): Rect | null =>
    wide ? { x: rect.x, y: y + mh + WIDE_GAP_PX, width: mw, height: wideHeight(mw) } : null;
  const mirrorLeft: Rect = { x: placed.left, y, width: mw, height: mh };
  return {
    cockpit,
    mirrorLeft,
    mirrorRight,
    wideLeft: under(mirrorLeft),
    wideRight: under(mirrorRight),
    front,
    close: extra.close ? closeRect(mirrorRight, floor) : null,
    topDown,
  };
}

type Column = { readonly y: number; readonly width: number; readonly height: number };

/**
 * The class II mirrors of `cockpit` (`left` is their left edge on the driver's side), whether class IV
 * hangs under them, and the front mirror. `rise` is, portrait, how many px the cockpit's top can still
 * rise as the share shrinks to its minimum; `floor` the least y a mirror may start at.
 */
function placeMirrors({
  cssWidth,
  cssHeight,
  mirrorsOnly,
  legend,
  insets,
  extra,
  cockpit,
  rise,
}: {
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly mirrorsOnly: boolean;
  readonly legend: LegendBox | null;
  readonly insets: Insets;
  readonly extra: ExtraMirrors;
  readonly cockpit: Rect;
  readonly rise: number;
}): {
  readonly mirror: Column & { readonly wide: boolean };
  readonly mirrorRight: Rect;
  readonly front: Rect | null;
  readonly left: number;
  readonly floor: number;
} {
  const fullWidth = clamp(
    Math.round(MIRROR_SCALE * 0.15 * cockpit.width),
    Math.round(MIRROR_SCALE * 72),
    Math.round(MIRROR_SCALE * 200),
  );
  const wanted = Math.min(2 * fullWidth, Math.round(MIRROR_SCALE * 0.5 * cockpit.height));
  // Only a cockpit that starts at the screen's top edge sits under the display cut-out there.
  const top = belowCutOut(cockpit, insets).y - cockpit.y;
  // Without the top-down pane the pause button stands over the cockpit's top right corner, above the mirrors.
  const floor =
    cockpit.y +
    top +
    Math.max(COCKPIT_LABEL, mirrorsOnly ? INSET + tokenPx('--size-target', 44) + MIRROR_GAP : 0);
  const left = cockpit.x + INSET + insets.left;
  // Landscape, a cockpit that reaches the screen's right edge shares it with the lever column (`.ctl-lever`).
  const leverClear =
    mirrorsOnly && cssWidth >= cssHeight ? 1.5 * tokenPx('--size-target', 44) + INSET : 0;
  const right =
    cockpit.x +
    cockpit.width -
    INSET -
    (cockpit.x + cockpit.width >= cssWidth ? insets.right : 0) -
    leverClear;
  const controls = controlsHeight(cssWidth, cssHeight, insets);
  const preferred = cockpit.y + top + Math.round(0.16 * cockpit.height);
  /** The largest class II mirror with its bottom `clear` above the viewport bottom and at most `maxWidth` wide. */
  const plainFit = (clear: number, maxWidth: number): Column => {
    const ceiling = cssHeight - clear - MIRROR_GAP;
    const y = Math.min(preferred, Math.max(floor, ceiling - wanted));
    const lowest = Math.max(MIN_SQUEEZED_HEIGHT, Math.min(MIN_MIRROR_HEIGHT, ceiling - y));
    let height = clamp(ceiling - y, lowest, wanted);
    if ((fullWidth * height) / wanted > maxWidth) {
      height = Math.max(lowest, Math.floor((maxWidth * wanted) / fullWidth));
    }
    // the rounded width must not exceed `maxWidth` either
    while (height > lowest && Math.round((fullWidth * height) / wanted) > maxWidth) {
      height--;
    }
    return { y, width: Math.round((fullWidth * height) / wanted), height };
  };
  // The forward sight cone, `CLEAR_CONE_DEG` about the view axis, is a circle about the cockpit's centre in px.
  const cone = {
    x: cockpit.x + cockpit.width / 2,
    y: cockpit.y + cockpit.height / 2,
    r: (coneTop(COCKPIT_FOV) * cockpit.height) / 2,
  };
  const covers = (x: number, y: number, width: number, height: number): boolean =>
    Math.hypot(
      Math.max(0, x - cone.x, cone.x - x - width),
      Math.max(0, y - cone.y, cone.y - y - height),
    ) < cone.r;
  /** Whether either class II column `width` wide, from `y` to `y + height`, reaches into the cone. */
  const inCone = (y: number, width: number, height: number): boolean =>
    covers(left, y, width, height) || covers(right - width, y, width, height);
  /** The bottom edge both class II columns `width` wide must stay above to clear the cone. */
  const coneBottom = (width: number): number => {
    const side = (x: number): number => {
      const gap = Math.max(0, x - cone.x, cone.x - x - width);
      return gap >= cone.r ? Infinity : cone.y - Math.sqrt(cone.r ** 2 - gap ** 2);
    };
    return Math.min(side(left), side(right - width));
  };
  /**
   * `fit`, or where it covers the sight cone the largest class II mirror down to `MIN_CLASS_II_SHARE` of
   * it that clears the cone, moved up no higher than `floor`; else the smallest at `floor`.
   */
  const clearOfCone = (fit: Column): Column => {
    if (!inCone(fit.y, fit.width, fit.height)) return fit;
    const highest = Math.min(fit.y, floor);
    const least = Math.max(
      Math.min(MIN_MIRROR_HEIGHT, fit.height),
      Math.ceil(MIN_CLASS_II_SHARE * fit.height),
    );
    let smallest = fit;
    for (let height = fit.height; height >= least; height--) {
      const width = Math.round((fullWidth * height) / wanted);
      if (width < Math.ceil(MIN_CLASS_II_SHARE * fit.width)) break;
      // where it covers the cone in place, the lowest whole-px top strictly above it
      const y = inCone(fit.y, width, height) ? Math.ceil(coneBottom(width) - height) - 1 : fit.y;
      if (y >= highest) return { y, width, height };
      smallest = { y: highest, width, height };
    }
    return smallest;
  };
  /**
   * With class IV: the largest class II mirror that leaves the stack (class II, a gap, class IV) its
   * bottom `clear` above the viewport bottom and clear of the sight cone (moved up for it as
   * `clearOfCone` moves class II), at most `maxWidth` wide, its top no higher than `minTop`, and no
   * smaller than `MIN_CLASS_II_SHARE` of `reference`, the size it has without class IV and the cone.
   * Null where nothing fits.
   */
  const stackFit = (
    clear: number,
    maxWidth: number,
    reference: Column,
    minTop: number,
  ): Column | null => {
    const ceiling = cssHeight - clear - MIRROR_GAP;
    const leastOf = (ref: { readonly width: number; readonly height: number }) => ({
      width: Math.max(MIN_WIDE_WIDTH, Math.ceil(MIN_CLASS_II_SHARE * ref.width)),
      height: Math.max(MIN_MIRROR_HEIGHT, Math.ceil(MIN_CLASS_II_SHARE * ref.height)),
    });
    const least = leastOf(reference);
    // A smaller share raises a portrait cockpit's top, so the reference and the room grow alike, and
    // the rounded minimum fits at one reference and not at the next. Class IV stays only where its
    // smallest stack also fits at every larger reference the share can still reach: as the share
    // grows it then drops once, where it first stops fitting.
    const room = ceiling - Math.min(preferred, minTop);
    for (let more = 1; more <= rise && reference.height + more - 1 < wanted; more++) {
      const taller = Math.min(wanted, reference.height + more);
      const atLeast = leastOf({ width: Math.round((fullWidth * taller) / wanted), height: taller });
      let height = atLeast.height;
      while (Math.round((fullWidth * height) / wanted) < atLeast.width) height++;
      const width = Math.round((fullWidth * height) / wanted);
      if (height + WIDE_GAP_PX + wideHeight(width) > room + more) return null;
    }
    const start = plainFit(clear, maxWidth).height;
    for (let height = start; height >= least.height; height--) {
      const width = Math.round((fullWidth * height) / wanted);
      if (width < least.width) break;
      const stack = height + WIDE_GAP_PX + wideHeight(width);
      const fit = Math.min(preferred, Math.max(minTop, ceiling - stack));
      if (fit + stack > ceiling) continue;
      // where the stack covers the cone in place, the lowest whole-px top that keeps it above the cone
      const y =
        inCone(fit, width, height) || inCone(fit + height + WIDE_GAP_PX, width, wideHeight(width))
          ? Math.ceil(coneBottom(width) - stack) - 1
          : fit;
      if (y >= Math.min(fit, minTop)) return { y, width, height };
    }
    return null;
  };
  /**
   * The class II mirror's placement and whether class IV hangs under it. Where the legend reaches
   * under the right mirror the choice is between sitting above it and beside it: the placement that
   * holds class IV wins, then the larger one. Class IV is dropped where none does; class II yields to
   * the sight cone (`clearOfCone`).
   */
  const choose = (wide: boolean, minTop: number): Column & { readonly wide: boolean } => {
    // The mirror only shrinks and moves inward from its full width, so that width is the worst case.
    const reachesLegend = legend !== null && legend.right > right - fullWidth;
    const options: { clear: number; maxWidth: number }[] = [
      { clear: controls, maxWidth: fullWidth },
    ];
    if (legend !== null && reachesLegend) {
      options[0] = { clear: Math.max(controls, legend.height), maxWidth: fullWidth };
      const beside = { clear: controls, maxWidth: Math.max(0, right - legend.right) };
      // beside only where the mirror stays clear of the legend
      if (right - plainFit(beside.clear, beside.maxWidth).width >= legend.right)
        options.push(beside);
    }
    const area = (c: Column): number => c.width * c.height;
    const best = (cs: readonly Column[]): Column | undefined =>
      cs.reduce<Column | undefined>(
        (a, c) => (a === undefined || area(c) > area(a) ? c : a),
        undefined,
      );
    const fits = options.map((o) => plainFit(o.clear, o.maxWidth));
    const reference = best(fits);
    const plain = best(fits.map(clearOfCone));
    if (reference === undefined || plain === undefined) throw new Error('a placement');
    if (!wide) return { ...plain, wide: false };
    const stacked = best(
      options.flatMap((o) => stackFit(o.clear, o.maxWidth, reference, minTop) ?? []),
    );
    return stacked === undefined ? { ...plain, wide: false } : { ...stacked, wide: true };
  };
  const placed = (mirror: Column & { readonly wide: boolean }) => {
    const { y, width: mw, height: mh } = mirror;
    const mirrorRight: Rect = { x: right - mw, y, width: mw, height: mh };
    const messagesLeft = left + mw + MESSAGE_GAP;
    let front: Rect | null = null;
    if (extra.front) {
      // the toast column left of it starts right of the left mirror
      const leftLimit = messagesLeft + MIN_MESSAGE_WIDTH + MESSAGE_GAP;
      const fits = (rect: Rect): boolean =>
        messagesFit(
          cockpit,
          { x: messagesLeft, width: rect.x - MESSAGE_GAP - messagesLeft },
          cssWidth,
          cssHeight,
          controls,
          insets,
          legend,
        );
      front = frontRect(
        cockpit,
        mirrorRight,
        leftLimit,
        cockpit.y + top,
        cssHeight,
        controls,
        legend,
        fits,
      );
    }
    return { mirror, mirrorRight, front };
  };
  let solved = placed(choose(extra.wide, floor));
  if (solved.mirror.wide && solved.front === null) {
    // The messages span the cockpit: the stack stays below the toast row, or class IV goes.
    const toastBottom = cockpit.y + top + INSET + messageHeights(cockpit.width - insets.left).toast;
    const clearOfToast = toastBottom + MESSAGE_GAP;
    if (solved.mirror.y < clearOfToast) {
      const retry = placed(choose(true, clearOfToast));
      solved = retry.mirror.wide ? retry : placed(choose(false, floor));
    }
  }
  return { ...solved, left, floor };
}

/**
 * The class V mirror in the room left above the right class II mirror, right-aligned with it and no
 * wider; nothing but that room limits it, so it never moves or shrinks the mirrors under it. Null below
 * `MIN_CLOSE_WIDTH`.
 */
function closeRect(mirrorRight: Rect, ceiling: number): Rect | null {
  const height = Math.min(
    Math.floor(mirrorRight.width / CLOSE_ASPECT),
    mirrorRight.y - WIDE_GAP_PX - ceiling,
  );
  const width = CLOSE_ASPECT * height;
  if (width < MIN_CLOSE_WIDTH) return null;
  return {
    x: mirrorRight.x + mirrorRight.width - width,
    y: mirrorRight.y - WIDE_GAP_PX - height,
    width,
    height,
  };
}

/**
 * Lines `text` takes in a box `width` px wide, by greedy wrap over `wordPx` at spaces and soft hyphens
 * (a break there ends the line with a hyphen); a piece wider than the box takes a line.
 */
export function wrapLines(text: string, width: number): number {
  let lines = 1;
  let used = 0;
  for (const word of text.split(/\s+/)) {
    let pieces = word.split(SOFT_HYPHEN);
    while (pieces.length > 0) {
      const at = used === 0 ? 0 : used + SPACE_PX;
      const px = (n: number): number =>
        n === pieces.length ? wordPx(pieces.join('')) : wordPx(`${pieces.slice(0, n).join('')}-`);
      let n = pieces.length;
      while (n > 0 && at + px(n) > width) n--;
      if (n === 0 && used > 0) {
        lines++;
        used = 0;
        continue;
      }
      n = Math.max(n, 1);
      if (n === pieces.length) used = at + px(n);
      else {
        lines++;
        used = 0;
      }
      pieces = pieces.slice(n);
    }
  }
  return lines;
}

const mostLines = (texts: readonly string[], width: number): number =>
  Math.max(...texts.map((text) => wrapLines(text, width)));

const textsOf = (keys: readonly MessageKey[]): string[] =>
  keys.flatMap((key) => [en[key], de[key]]);

/** The goal cue's messages as shown: the distance leads the angle verdict. */
const cueTexts = (): string[] =>
  [en, de].flatMap((lang) => [
    lang.goalInside,
    lang.goalPositionOk,
    `${lang.goalDistance} ${lang.goalAngleOk}`,
    `${lang.goalDistance} ${lang.goalAngleOff}`,
  ]);

const messageHeightsAt = new Map<number, { toast: number; cue: number }>();

/** Heights of the longest toast and of the goal cue in a column `room` px wide. */
function messageHeights(room: number): { toast: number; cue: number } {
  // `wordPx` is whole px, so the wrap is that of the whole px below `room`
  const whole = Math.floor(room);
  let heights = messageHeightsAt.get(whole);
  if (heights === undefined) {
    // the toast's max-width leaves 32 px, its padding and borders take 41; the cue has no such margin
    heights = {
      toast: mostLines(textsOf(MESSAGE_KEYS.toast), whole - 32 - 41) * MESSAGE_LINE + MESSAGE_BOX,
      cue: mostLines(cueTexts(), whole - 34) * MESSAGE_LINE + MESSAGE_BOX,
    };
    messageHeightsAt.set(whole, heights);
  }
  return heights;
}

/** `rect` from below the display cut-out, which only a rect at the screen's top edge sits under. */
function belowCutOut(rect: Rect, insets: Insets): Rect {
  const top = rect.y === 0 ? insets.top : 0;
  return { ...rect, y: rect.y + top, height: rect.height - top };
}

/**
 * Whether the longest toast and the goal cue, stacked in `column` from the cockpit's top (below the
 * display cut-out), end above the controls, the key legend, the HUD band and the forward sight cone
 * they would otherwise reach into.
 */
function messagesFit(
  cockpit: Rect,
  column: { readonly x: number; readonly width: number },
  cssWidth: number,
  cssHeight: number,
  controls: number,
  insets: Insets,
  legend: LegendBox | null,
): boolean {
  const { toast, cue } = messageHeights(column.width);
  const stack = toast + MESSAGE_GAP + cue;
  const bottom = belowCutOut(cockpit, insets).y + INSET + stack;
  const reaches = (x0: number, x1: number): boolean =>
    column.x < x1 && column.x + column.width > x0;
  const wheel = wheelSize(cssWidth, cssHeight, insets);
  const gearsLeft = 2 * INSET + wheel + insets.left;
  if (reaches(INSET + insets.left, gearsLeft + GEARS_WIDTH)) {
    const gearsTop = cssHeight - INSET - insets.bottom - GEARS_HEIGHT;
    if (bottom > Math.min(cssHeight - controls, gearsTop)) return false;
  }
  if (
    legend !== null &&
    reaches(INSET + insets.left, legend.right) &&
    bottom > cssHeight - legend.height
  ) {
    return false;
  }
  if (bottom > cockpit.y + (1 - HUD_BAND_SHARE) * cockpit.height) return false;
  const cone = coneBox(cockpit);
  return !(reaches(cone.left, cone.right) && bottom > cone.top);
}

/** The forward sight cone's bounding box in `cockpit`. */
function coneBox(cockpit: Rect): { left: number; right: number; top: number } {
  const half = (coneEdge(cockpit.width / cockpit.height, COCKPIT_FOV) * cockpit.width) / 2;
  const centre = cockpit.x + cockpit.width / 2;
  const top = cockpit.y + ((1 - coneTop(COCKPIT_FOV)) / 2) * cockpit.height;
  return { left: centre - half, right: centre + half, top };
}

/**
 * The front mirror in the windscreen band of `cockpit` (`frontBand`), hung from the header at the
 * band's right, shrunk from its widest until it clears the controls, the key legend and leaves `fits`
 * (the messages) their room; null where that takes it below `MIN_FRONT_WIDTH`. `leftLimit` is the least x it may start at, which keeps the toast column wide
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
  fits: (rect: Rect) => boolean,
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
  const widest = Math.floor(
    Math.min(
      toY(band.bottom) - top,
      (right - Math.max(toX(band.left), leftLimit)) / FRONT_ASPECT,
      MAX_FRONT_WIDTH / FRONT_ASPECT,
    ),
  );
  // shrink, anchored at the band's top right, before giving up: a smaller mirror leaves the messages more room
  for (let height = widest; FRONT_ASPECT * height >= MIN_FRONT_WIDTH; height--) {
    const width = FRONT_ASPECT * height;
    const rect = { x: right - width, y: top, width, height };
    const bottom = rect.y + rect.height + MIRROR_GAP;
    if (bottom > cssHeight - controls) continue;
    if (legend !== null && legend.right > rect.x && bottom > cssHeight - legend.height) continue;
    if (fits(rect)) return rect;
  }
  return null;
}

/** The toast column; where `cueYields`, the goal cue hides while a toast shows (hud.css). */
export type MessageColumn = Rect & { readonly cueYields: boolean };

/** The Einweiser's sight cue at the top left of his view, below the display cut-out; tall enough for its longest text. */
export function sightCueBox(view: Rect, insets: Insets): Rect {
  const lines = mostLines(textsOf(MESSAGE_KEYS.sight), SIGHT_CUE_WIDTH - SIGHT_CUE_CHROME);
  return {
    x: view.x + insets.left + INSET,
    y: belowCutOut(view, insets).y + INSET,
    width: SIGHT_CUE_WIDTH,
    height: lines * MESSAGE_LINE + MESSAGE_BOX,
  };
}

/**
 * His view has no mirrors and no controls: the stack stands top-centre, between the sight cue and an
 * equal margin on the right where it fits there, else across the view below the cue. Where the key
 * legend leaves neither room, the top view takes it as it does the driver's; without one, the goal cue
 * yields.
 */
function einweiserColumn(
  views: ViewRects & { readonly cockpit: Rect },
  legend: LegendBox | null,
  insets: Insets,
): MessageColumn {
  const view = views.cockpit;
  const area = belowCutOut(view, insets);
  const cue = sightCueBox(view, insets);
  const margin = INSET + SIGHT_CUE_WIDTH + MESSAGE_GAP + Math.max(insets.left, insets.right);
  const beside = { ...area, x: view.x + margin, width: view.width - 2 * margin };
  const below = {
    x: view.x + insets.left,
    y: cue.y + cue.height,
    width: view.width - insets.left - insets.right,
    height: area.y + area.height - cue.y - cue.height,
  };
  const bandTop = view.y + (1 - HUD_BAND_SHARE) * view.height;
  // his view reaches the screen's bottom, which the legend's height is measured from
  const stageBottom = view.y + view.height;
  const fits = (column: Rect, yields: boolean): boolean => {
    if (column.width < MIN_MESSAGE_WIDTH) return false;
    const { toast, cue: goal } = messageHeights(column.width);
    const bottom = column.y + INSET + (yields ? Math.max(toast, goal) : toast + MESSAGE_GAP + goal);
    const overLegend =
      legend !== null &&
      column.x < legend.right &&
      column.x + column.width > INSET + insets.left &&
      bottom > stageBottom - legend.height;
    return bottom <= bandTop && !overLegend;
  };
  for (const column of [beside, below]) {
    if (fits(column, false)) return { ...column, cueYields: false };
  }
  // as the driver's: a key legend reaching that high sends them to the top view
  if (hasTopDown(views)) {
    const { topDown } = views;
    const cssWidth = Math.max(view.x + view.width, topDown.x + topDown.width);
    const cssHeight = Math.max(view.y + view.height, topDown.y + topDown.height);
    return paneColumn(topDown, insets, cssWidth >= cssHeight);
  }
  for (const column of [beside, below]) {
    if (fits(column, true)) return { ...column, cueYields: true };
  }
  return { ...below, cueYields: true };
}

/**
 * Where the toast and the goal cue stand, clear of the safe area: the column starts below the display
 * cut-out, which hud.css therefore leaves out. Beside the front mirror they take the cockpit's top
 * between the left mirror and the front mirror. Without one they take the span between the class II
 * mirrors where the stack fits there (`messagesFit`), else the top-down pane, below the finish button
 * and clear of the lever. With no such pane the cue yields to the toast between the class II mirrors.
 * In the Einweiser's view, see `einweiserColumn`.
 */
export function messageColumn(
  views: ViewRects,
  legend: LegendBox | null,
  safeInsets?: Insets,
): MessageColumn {
  const { cockpit, topDown, front, mirrorLeft, mirrorRight } = views;
  const insets = safeInsets ?? readSafeInsets();
  // only the Einweiser's view has no class II mirrors
  if (cockpit !== null && mirrorLeft === null)
    return einweiserColumn({ ...views, cockpit }, legend, insets);
  if (cockpit === null || mirrorLeft === null || mirrorRight === null) {
    const whole = belowCutOut(cockpit ?? topDown, insets);
    return {
      ...whole,
      x: whole.x + insets.left,
      width: whole.width - insets.left - insets.right,
      cueYields: false,
    };
  }
  const area = belowCutOut(cockpit, insets);
  const x = mirrorLeft.x + mirrorLeft.width + MESSAGE_GAP;
  if (front !== null) return { ...area, x, width: front.x - MESSAGE_GAP - x, cueYields: false };
  const between = { x, width: mirrorRight.x - MESSAGE_GAP - x };
  const cssWidth = Math.max(cockpit.x + cockpit.width, topDown.x + topDown.width);
  const cssHeight = Math.max(cockpit.y + cockpit.height, topDown.y + topDown.height);
  const controls = controlsHeight(cssWidth, cssHeight, insets);
  const fits =
    between.width >= MIN_MESSAGE_WIDTH &&
    messagesFit(cockpit, between, cssWidth, cssHeight, controls, insets, legend);
  if (fits) return { ...area, ...between, cueYields: false };
  // Mirror-only: the cue yields to the toast; no span beside the sight cone fits at a supported size.
  if (!hasTopDown(views)) return { ...area, ...between, cueYields: true };
  return paneColumn(topDown, insets, cssWidth >= cssHeight);
}

/**
 * The top-down pane below the finish button; in landscape also left of the stop button and lever, which
 * stand at the screen's right edge (`.ctl-stop`, `.ctl-lever` in controls.css). In portrait the pane spans the screen.
 */
function paneColumn(topDown: Rect, insets: Insets, landscape: boolean): MessageColumn {
  const pane = belowCutOut(topDown, insets);
  const drop = tokenPx('--size-target', 44) + MESSAGE_GAP;
  const left = landscape ? 0 : insets.left;
  const right = landscape ? paneLever(insets) : insets.right;
  return {
    ...pane,
    x: pane.x + left,
    y: pane.y + drop,
    height: pane.height - drop,
    width: pane.width - left - right,
    cueYields: false,
  };
}
