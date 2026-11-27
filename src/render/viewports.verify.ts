/**
 * Bounded exhaustive verification of the layout promises of `computeViewports`, `topDownSplit` and
 * `messageColumn` (`pnpm verify:layout`, skill `verify-viewport-layout`). It runs the real code at every
 * integer CSS (width, height) in the bounds below, for a named, sampled list of config variants.
 *
 * The properties come from CLAUDE.md ("Layering"), the doc comments in `viewports.ts` and
 * `expectMessagesClear` in `e2e/layout.spec.ts`, not from what `viewports.test.ts` tolerates. A failure
 * is a counterexample list, never a reason to shrink the bounds or loosen a property.
 */
import { describe, it } from 'vitest';
import {
  DEFAULT_TOP_DOWN_LAYOUT,
  NO_EXTRA_MIRRORS,
  TOP_DOWN_SHARE_LIMITS,
  type ExtraMirrors,
  type LegendBox,
  type Rect,
  type TopDownLayout,
  type TopDownSplit,
  type ViewMode,
  type ViewRects,
} from '../contracts/render';
import type { Role } from '../contracts/exercise';
import { de } from '../i18n/de';
import { en } from '../i18n/en';
import { CLOSE_ASPECT, MIN_CLOSE_WIDTH } from './close-mirror';
import {
  CLEAR_CONE_DEG,
  COCKPIT_FOV,
  coneEdge,
  coneTop,
  FRONT_GAP_PX,
  VISOR,
} from './cockpit-band';
import { extraMirrors } from './index';
import {
  computeViewports,
  controlsHeight,
  FRONT_ASPECT,
  HUD_BAND_SHARE,
  MESSAGE_GAP,
  MESSAGE_KEYS,
  messageColumn,
  MIN_CLASS_II_SHARE,
  MIN_FRONT_WIDTH,
  MIN_MESSAGE_WIDTH,
  MIN_MIRROR_HEIGHT,
  MIN_SQUEEZED_HEIGHT,
  MIN_WIDE_WIDTH,
  NO_INSETS,
  orientationOf,
  topDownSplit,
  wheelSize,
  wideHeight,
  WIDE_GAP_PX,
  wrapLines,
  type Insets,
  type PanelStack,
} from './viewports';
import {
  declared,
  GEOM,
  HUD_THRESHOLDS,
  metricsAt,
  parts,
  px,
  SOURCE,
  type Metrics,
} from './viewports-css';

/* ------------------------------------------------------------------------------------------------
 * Bounds: every integer CSS width x height in each box. Phones are out of scope (no target).
 * ---------------------------------------------------------------------------------------------- */

type Box = {
  readonly name: string;
  readonly w: readonly [number, number];
  readonly h: readonly [number, number];
};

/** The smallest supported CSS viewport height (`docs/usage.md`): a 1080p laptop at 150 % scaling. */
const MIN_HEIGHT = 585;

/**
 * Default: each box is exhaustive, the boxes are not contiguous. Laptops incl. the short ones in
 * CLAUDE.md, 1080p and 1440p desktops, tablets in landscape and portrait.
 */
const DEFAULT_BOXES: readonly Box[] = [
  { name: 'laptop', w: [1280, 1600], h: [MIN_HEIGHT, 800] },
  { name: 'desktop 1080p', w: [1900, 1940], h: [1060, 1100] },
  { name: 'desktop 1080p window', w: [1900, 1940], h: [900, 1000] },
  { name: 'desktop 1440p', w: [2400, 2560], h: [1300, 1440] },
  { name: 'tablet landscape', w: [1000, 1200], h: [600, 800] },
  { name: 'tablet portrait', w: [600, 820], h: [900, 1200] },
  { name: 'tablet portrait 834', w: [821, 850], h: [1100, 1210] },
];

/** `VERIFY_LAYOUT=full`: one contiguous box over the laptops and desktops, and one each for tablets in landscape and portrait. */
const FULL_BOXES: readonly Box[] = [
  { name: 'laptop and desktop', w: [1024, 2560], h: [MIN_HEIGHT, 1440] },
  // From the smallest supported landscape width (`docs/usage.md`).
  { name: 'tablet landscape', w: [800, 1023], h: [MIN_HEIGHT, 1000] },
  { name: 'tablet portrait', w: [600, 1280], h: [800, 1600] },
];

const range = (text: string | undefined): readonly [number, number] | null => {
  const m = /^(\d+)-(\d+)$/.exec(text ?? '');
  if (m?.[1] === undefined || m[2] === undefined) return null;
  const [low, high] = [Number(m[1]), Number(m[2])];
  return low <= high ? [low, high] : null;
};

/**
 * `VERIFY_LAYOUT_W=a-b VERIFY_LAYOUT_H=c-d` replaces the boxes with one (for mutation runs and bisecting);
 * one of them alone, or a malformed one, throws rather than running the named bounds unjudged.
 */
function selection(): { readonly boxes: readonly Box[]; readonly custom: boolean } {
  const wText = process.env['VERIFY_LAYOUT_W'];
  const hText = process.env['VERIFY_LAYOUT_H'];
  if (wText === undefined && hText === undefined) {
    return {
      boxes: process.env['VERIFY_LAYOUT'] === 'full' ? FULL_BOXES : DEFAULT_BOXES,
      custom: false,
    };
  }
  const w = range(wText);
  const h = range(hText);
  if (w === null || h === null) {
    throw new Error('VERIFY_LAYOUT_W and VERIFY_LAYOUT_H must both be set, each as <min>-<max>');
  }
  return { boxes: [{ name: 'custom', w, h }], custom: true };
}

/* ------------------------------------------------------------------------------------------------
 * CSS geometry the properties are measured against: read from the stylesheets (`viewports-css.ts`).
 * ---------------------------------------------------------------------------------------------- */

const SPACE_4 = GEOM.space4;
/** How far below a mirror's rect its view frame (`--hud-frame`, outset box shadows) reaches: y offset, blur and spread. */
const HUD_FRAME = Math.max(
  ...declared(SOURCE.hud, '.hud', '--hud-frame')
    .split(/,(?![^(]*\))/)
    .map((shadow) => {
      const [, y = '0', blur = '0', spread = '0'] = parts(shadow.trim());
      return px(y) + px(blur) + px(spread);
    }),
);
const TARGET = GEOM.target;
const GEARS_W = GEOM.gearsW;
const LEGEND_W = GEOM.legendW;
const LABEL_BLOCK = GEOM.labelBlock;
const STOP_BLOCK = GEOM.stopBlock;
const STOP_GAP = GEOM.stopGap;
const GEARS_HEIGHT = GEOM.gearsHeight;
const COCKPIT_LABEL = GEOM.cockpitLabel;
const MESSAGE_LINE = GEOM.messageLine;
const MESSAGE_BOX = GEOM.messageBox;
const PEDAL_W = GEOM.pedalW;

/* ------------------------------------------------------------------------------------------------
 * Variants: a named, sampled list of config tuples (not a cross product).
 * ---------------------------------------------------------------------------------------------- */

type Mode = ViewMode | 'mirrors';
type PanelKind = 'none' | 'steps' | 'never';
/** `keysOpen`: the chevron of a short cockpit is open, which shows the full list. */
type LegendKind = 'none' | 'measured' | 'keysOpen';
type Variant = {
  readonly name: string;
  readonly mode: Mode;
  readonly role: Role;
  readonly extra: ExtraMirrors;
  readonly layout: TopDownLayout;
  readonly legend: LegendKind;
  readonly panels: PanelKind;
  readonly insets: Insets;
};

const BALANCED = extraMirrors('balanced', true);
/** A tablet's home indicator; and a landscape display cut-out (the test values in `viewports.test.ts`). */
const HOME: Insets = { top: 0, right: 0, bottom: 20, left: 0 };
const NOTCH: Insets = { top: 24, right: 48, bottom: 20, left: 48 };
/** The share clamp: stored shares outside the limits (`settings.ts` clamps them, so these are the extremes). */
const SHARE_MIN: TopDownLayout = { landscape: 0, portrait: 0 };
const SHARE_MAX: TopDownLayout = { landscape: 1, portrait: 1 };

const base = (name: string, over: Partial<Omit<Variant, 'name'>>): Variant => ({
  name,
  mode: 'drive',
  role: 'driver',
  extra: BALANCED,
  layout: DEFAULT_TOP_DOWN_LAYOUT,
  legend: 'none',
  panels: 'none',
  insets: NO_INSETS,
  ...over,
});

const VARIANTS: readonly Variant[] = [
  base('drive balanced', {}),
  base('drive, no extra mirrors', { extra: NO_EXTRA_MIRRORS }),
  base('drive low', { extra: extraMirrors('low', true) }),
  base('drive high', { extra: extraMirrors('high', true) }),
  base('drive balanced, class IV off', { extra: extraMirrors('balanced', false) }),
  base('drive balanced, share min', { layout: SHARE_MIN }),
  base('drive balanced, share max', { layout: SHARE_MAX }),
  base('drive balanced, legend', { legend: 'measured' }),
  base('drive balanced, legend with all keys', { legend: 'keysOpen' }),
  base('drive balanced, panels steps', { panels: 'steps' }),
  base('drive balanced, panels never fit', { panels: 'never' }),
  base('drive balanced, home indicator', { insets: HOME }),
  base('drive balanced, notch', { insets: NOTCH }),
  base('drive balanced, notch, legend, panels steps, share min', {
    insets: NOTCH,
    legend: 'measured',
    panels: 'steps',
    layout: SHARE_MIN,
  }),
  base('drive high, home indicator, legend, panels steps, share max', {
    extra: extraMirrors('high', true),
    insets: HOME,
    legend: 'measured',
    panels: 'steps',
    layout: SHARE_MAX,
  }),
  base('mirrors balanced', { mode: 'mirrors' }),
  base('mirrors balanced, legend with all keys', { mode: 'mirrors', legend: 'keysOpen' }),
  base('mirrors high, notch, legend', {
    mode: 'mirrors',
    extra: extraMirrors('high', true),
    insets: NOTCH,
    legend: 'measured',
  }),
  base('mirrors balanced, home indicator, legend', {
    mode: 'mirrors',
    insets: HOME,
    legend: 'measured',
  }),
  // The Einweiser's first-person view: the extras asked for, which the role must not draw.
  base('einweiser', { role: 'einweiser', extra: extraMirrors('high', true) }),
  base('einweiser, share min', { role: 'einweiser', layout: SHARE_MIN }),
  base('einweiser, share max', { role: 'einweiser', layout: SHARE_MAX }),
  base('einweiser, panels steps', { role: 'einweiser', panels: 'steps' }),
  base('einweiser, panels never fit', { role: 'einweiser', panels: 'never' }),
  base('einweiser, home indicator', { role: 'einweiser', insets: HOME }),
  base('einweiser, notch, panels steps, share min', {
    role: 'einweiser',
    insets: NOTCH,
    panels: 'steps',
    layout: SHARE_MIN,
  }),
  base('einweiser without the top view', { role: 'einweiser', mode: 'mirrors' }),
  base('einweiser without the top view, notch', {
    role: 'einweiser',
    mode: 'mirrors',
    insets: NOTCH,
  }),
  base('replay', { mode: 'replay', extra: NO_EXTRA_MIRRORS }),
  base('replay, notch', { mode: 'replay', extra: NO_EXTRA_MIRRORS, insets: NOTCH }),
];

/**
 * Stands in for the measured panels (the `STEPS` of `viewports.test.ts`): the bottom edge steps down as
 * the pane narrows, and the safe area pushes it further.
 */
const STEPS = [
  { from: 296, bottom: 545 },
  { from: 320, bottom: 515 },
  { from: 360, bottom: 485 },
  { from: 400, bottom: 380 },
  { from: 440, bottom: 305 },
];
const stepsPanel =
  (insets: Insets): PanelStack =>
  (paneWidth) => {
    let bottom = 600;
    for (const step of STEPS) if (paneWidth >= step.from) bottom = step.bottom;
    return bottom + insets.top;
  };
const neverFits: PanelStack = () => Infinity;
const panelsOf = (v: Variant): PanelStack | null =>
  v.panels === 'none' ? null : v.panels === 'steps' ? stepsPanel(v.insets) : neverFits;

/**
 * The legend's states and the widest and tallest box each had in a headless Chromium run of the app
 * (en and de): the toggle only on a short screen, the drive keys on a short cockpit, the compact list on
 * a narrow cockpit, the full list, and the full list without the top-down rows in the mirror-only drive.
 */
const LEGEND_BOXES = {
  overlay: { width: 97, height: 42 },
  driveOnly: { width: 282, height: 126 },
  compact: { width: 159, height: 194 },
  full: { width: 315, height: 286 },
  mirrorsFull: { width: 303, height: 190 },
};
const { SHORT_SCREEN, SHORT_HEIGHT, COMPACT_WIDTH, COMPACT_WIDTH_WITH_LEVER } = HUD_THRESHOLDS;

/* ------------------------------------------------------------------------------------------------
 * Properties, each one named check.
 * ---------------------------------------------------------------------------------------------- */

const PROPERTIES = [
  'rects-finite-positive',
  'drive-rects-present',
  'einweiser-has-no-mirrors',
  'rects-inside-viewport',
  'screen-tiled-by-cockpit-and-top-down',
  'mirror-only-has-no-top-down-pane',
  'split-within-limits-and-clamp',
  'split-matches-top-down-rect',
  'wheel-size-matches-css',
  'cockpit-keeps-room-for-controls (deficit over 0.5 px)',
  'cockpit-keeps-room-for-controls (deficit up to 0.5 px, pane rounding)',
  'extras-only-when-asked',
  'mirrors-inside-cockpit',
  'mirrors-inside-safe-area',
  'mirrors-below-cockpit-label',
  'mirror-only-clear-of-pause-button-and-lever',
  'mirrors-above-controls-band (frame clear of the controls)',
  'mirrors-above-controls-band (height at MIN_SQUEEZED_HEIGHT)',
  'mirrors-clear-of-control-boxes',
  'mirrors-above-hud-band',
  'mirrors-clear-of-legend',
  'wide-mirrors-clear-of-sight-cone',
  'class-ii-clear-of-sight-cone',
  'mirrors-and-message-column-disjoint',
  'class-iv-hangs-under-class-ii',
  'class-ii-keeps-share-with-class-iv',
  'front-mirror-geometry',
  'close-mirror-geometry',
  'message-column-valid',
  'message-column-inside-safe-area',
  'message-column-placement',
  'message-cue-yields-only-without-room',
  'message-stack-fits-pane',
  'message-stack-clear-of-sight-cone',
  'message-stack-clear-of-controls-and-hud-band',
  'message-stack-clear-of-legend',
  'message-stack-clear-of-mirrors',
  'message-stack-clear-of-action-button',
] as const;
type Property = (typeof PROPERTIES)[number];

/** What a property's magnitude measures: the sight cone in degrees, every other one in px (0 where it is a yes or no). */
const unitOf = (p: Property): 'px' | 'deg' =>
  p === 'wide-mirrors-clear-of-sight-cone' || p === 'class-ii-clear-of-sight-cone' ? 'deg' : 'px';

/**
 * A finding's baseline in one (property, variant) pair and bounds, per box of the bounds: how many
 * checks fail and the worst magnitude, rounded up to 4 decimals. A box that fails more often or worse
 * is a regression; one that fails less often or milder must be lowered to the new numbers.
 */
type BoxBaseline = readonly [failures: number, worst: number];
type Baseline = { readonly issue: string; readonly boxes: Readonly<Record<string, BoxBaseline>> };
type KnownTable = Readonly<Partial<Record<Property, Readonly<Record<string, Baseline>>>>>;
/** Rounds a magnitude up to the 4 decimals a baseline holds. */
const ceil4 = (x: number): number => Math.ceil(x * 1e4) / 1e4;

/**
 * Counterexamples already filed as issues, per bounds. A counterexample in a listed (property, variant)
 * pair is KNOWN and does not fail the run while it equals the baseline in every box; any other fails.
 * A listed pair without one in its bounds is STALE and fails too: the issue was fixed, remove the entry.
 */
const KNOWN_FINDINGS: { readonly default: KnownTable; readonly full: KnownTable } = {
  default: {},
  full: {},
};

type Failures = {
  n: number;
  worst: number;
  perBox: Map<string, { n: number; worst: number }>;
  examples: string[];
  box: { w0: number; w1: number; h0: number; h1: number };
};
type Stat = { applied: number; byVariant: Map<string, Failures> };
const EXAMPLES = 3;

const stats = new Map<Property, Stat>(
  PROPERTIES.map((p) => [p, { applied: 0, byVariant: new Map() }]),
);
const cur = { box: '', variant: '', w: 0, h: 0 };

/** Counts an evaluation of `p` and returns whether it held; the caller reports the detail only on failure. */
function chk(p: Property, held: boolean): boolean {
  const s = stats.get(p);
  if (s === undefined) throw new Error(p);
  s.applied++;
  return held;
}

/** Records a failure of `p`; `magnitude` is how far it fails (see `unitOf`), 0 where there is no measure. */
function fail(p: Property, detail: () => string, magnitude = 0): void {
  const s = stats.get(p);
  if (s === undefined) throw new Error(p);
  let f = s.byVariant.get(cur.variant);
  if (f === undefined) {
    f = {
      n: 0,
      worst: 0,
      perBox: new Map(),
      examples: [],
      box: { w0: Infinity, w1: -Infinity, h0: Infinity, h1: -Infinity },
    };
    s.byVariant.set(cur.variant, f);
  }
  const worst = Number.isNaN(magnitude) ? Infinity : magnitude;
  f.n++;
  f.worst = Math.max(f.worst, worst);
  const inBox = f.perBox.get(cur.box) ?? { n: 0, worst: 0 };
  inBox.n++;
  inBox.worst = Math.max(inBox.worst, worst);
  f.perBox.set(cur.box, inBox);
  f.box.w0 = Math.min(f.box.w0, cur.w);
  f.box.w1 = Math.max(f.box.w1, cur.w);
  f.box.h0 = Math.min(f.box.h0, cur.h);
  f.box.h1 = Math.max(f.box.h1, cur.h);
  if (f.examples.length < EXAMPLES) f.examples.push(`${cur.w}x${cur.h} ${detail()}`);
}

const right = (r: Rect): number => r.x + r.width;
const bottom = (r: Rect): number => r.y + r.height;
const finite = (r: Rect): boolean =>
  Number.isFinite(r.x) &&
  Number.isFinite(r.y) &&
  Number.isFinite(r.width) &&
  Number.isFinite(r.height);
/** Intersection area's sides in px (both positive when the rects overlap). */
const overlapX = (a: Rect, b: Rect): number => Math.min(right(a), right(b)) - Math.max(a.x, b.x);
const overlapY = (a: Rect, b: Rect): number => Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y);
const overlaps = (a: Rect, b: Rect): boolean => overlapX(a, b) > 1e-9 && overlapY(a, b) > 1e-9;
/** How deep two overlapping rects reach into each other in px; grows with either side of the overlap. */
const depth = (a: Rect, b: Rect): number =>
  Math.hypot(Math.max(0, overlapX(a, b)), Math.max(0, overlapY(a, b)));
const fmt = (r: Rect): string => `(${r.x},${r.y} ${r.width}x${r.height})`;

/* Message stack: toast, gap, goal cue, as `expectMessagesClear` measures them (hud.css `.hud-toast`). */
const toastTexts: readonly string[] = [en, de].flatMap((lang) =>
  MESSAGE_KEYS.toast.map((key) => lang[key]),
);
/**
 * The goal cue's texts: each key alone, except that the angle verdicts (`goalAngle*`) follow the distance
 * (`goalDistance`), which is never shown alone.
 */
const cueTexts: readonly string[] = [en, de].flatMap((lang) =>
  MESSAGE_KEYS.cue.flatMap((key) =>
    key === 'goalDistance'
      ? []
      : [key.startsWith('goalAngle') ? `${lang.goalDistance} ${lang[key]}` : lang[key]],
  ),
);
const mostLines = (texts: readonly string[], width: number): number =>
  Math.max(...texts.map((text) => wrapLines(text, width)));
const stackCache = new Map<number, { toast: number; cue: number }>();
/** Heights of the longest toast and of the goal cue in a column `room` px wide. */
function messageHeights(room: number): { toast: number; cue: number } {
  const cached = stackCache.get(room);
  if (cached !== undefined) return cached;
  const heights = {
    toast:
      mostLines(toastTexts, room - GEOM.toastMargin - GEOM.toastBox) * MESSAGE_LINE + MESSAGE_BOX,
    cue: mostLines(cueTexts, room - GEOM.cueBox) * MESSAGE_LINE + MESSAGE_BOX,
  };
  stackCache.set(room, heights);
  return heights;
}
/**
 * Height of the longest toast, the gap and the goal cue in a column `room` px wide; where the cue
 * `yields` to a toast, of the taller one alone.
 */
function stackHeight(room: number, yields = false): number {
  const { toast, cue } = messageHeights(room);
  return yields ? Math.max(toast, cue) : toast + GEOM.stackGap + cue;
}

type Named = { readonly name: string; readonly rect: Rect };

/**
 * How far (degrees) the nearest point of `rect` lies inside the forward sight cone of the cockpit camera
 * (vertical FOV `COCKPIT_FOV`, the cockpit rect's aspect, no view offset); 0 where it lies outside.
 * The cone is the circle of `CLEAR_CONE_DEG` on the tangent plane, as `cockpit-band.ts` cuts it; a
 * point's angle off the axis is the arctangent of its distance from the centre there, which grows with
 * each of |x| and |y|, so the nearest point has the smaller |x| and |y| the rect's edges allow.
 */
function coneDepth(rect: Rect, cockpit: Rect): number {
  const tan = Math.tan((COCKPIT_FOV * Math.PI) / 360);
  const aspect = cockpit.width / cockpit.height;
  const nearest = (lo: number, hi: number): number =>
    lo <= 0 && hi >= 0 ? 0 : Math.min(Math.abs(lo), Math.abs(hi));
  const x0 = (2 * (rect.x - cockpit.x)) / cockpit.width - 1;
  const x1 = (2 * (right(rect) - cockpit.x)) / cockpit.width - 1;
  const y0 = 1 - (2 * (bottom(rect) - cockpit.y)) / cockpit.height;
  const y1 = 1 - (2 * (rect.y - cockpit.y)) / cockpit.height;
  const off = Math.atan(Math.hypot(nearest(x0, x1) * aspect * tan, nearest(y0, y1) * tan));
  return Math.max(0, CLEAR_CONE_DEG - (off * 180) / Math.PI);
}

/**
 * The key legend as `hud.ts` shows it at this size, with the largest of its measured boxes (headless
 * Chromium, en and de; `LEGEND_BOXES`). Null where it is hidden.
 */
function legendFor(
  kind: LegendKind,
  mode: Mode,
  views: ViewRects,
  w: number,
  h: number,
  m: Metrics,
): { box: LegendBox; left: number; width: number } | null {
  const { cockpit } = views;
  if (kind === 'none' || cockpit === null) return null;
  if (mode === 'mirrors' && w < h) return null;
  // `spansRight` in hud.ts
  const compact =
    cockpit.width < (right(cockpit) >= w - 1 ? COMPACT_WIDTH_WITH_LEVER : COMPACT_WIDTH);
  const state =
    h < SHORT_SCREEN
      ? LEGEND_BOXES.overlay
      : compact
        ? LEGEND_BOXES.compact
        : cockpit.height < SHORT_HEIGHT && kind === 'measured'
          ? LEGEND_BOXES.driveOnly
          : mode === 'mirrors'
            ? LEGEND_BOXES.mirrorsFull
            : LEGEND_BOXES.full;
  // `.hud-legend` stands at `--hud-inset` from the cockpit's left and above the HUD band
  const left = m.hudInset;
  const lift = HUD_BAND_SHARE * cockpit.height + GEOM.legendLift;
  return {
    box: { right: left + state.width, height: lift + state.height },
    left,
    width: state.width,
  };
}

/** One (variant, size): run the real code and evaluate every property. */
function evaluate(v: Variant, w: number, h: number): void {
  cur.variant = v.name;
  cur.w = w;
  cur.h = h;
  const { insets } = v;
  const m = metricsAt(w, h, insets);
  const panels = panelsOf(v);
  const run = (legend: LegendBox | null, extra: ExtraMirrors): ViewRects =>
    computeViewports(w, h, v.mode, legend, insets, v.layout, panels, extra, v.role);

  const first = run(null, v.extra);
  const legend = legendFor(v.legend, v.mode, first, w, h, m);
  const views = legend === null ? first : run(legend.box, v.extra);
  const { cockpit, topDown } = views;
  const landscape = w >= h;

  /* geometry and tiling */
  const named: Named[] = [];
  const add = (name: string, rect: Rect | null): void => {
    if (rect !== null) named.push({ name, rect });
  };
  add('cockpit', cockpit);
  add('mirrorLeft', views.mirrorLeft);
  add('mirrorRight', views.mirrorRight);
  add('wideLeft', views.wideLeft);
  add('wideRight', views.wideRight);
  add('front', views.front);
  add('close', views.close);
  add('topDown', topDown);
  const column = messageColumn(views, legend?.box ?? null, insets);
  add('messageColumn', column);

  for (const { name, rect } of named) {
    // the top-down pane is zero-wide in the mirror-only drive
    const noWidth = name === 'topDown' && v.mode === 'mirrors';
    const sane = finite(rect) && rect.height > 0 && (rect.width > 0 || noWidth);
    if (!chk('rects-finite-positive', sane))
      fail('rects-finite-positive', () => `${name} ${fmt(rect)}`);
    const inside =
      rect.x >= 0 && rect.y >= 0 && right(rect) <= w + 1e-9 && bottom(rect) <= h + 1e-9;
    if (!chk('rects-inside-viewport', inside)) {
      fail(
        'rects-inside-viewport',
        () => `${name} ${fmt(rect)} in ${w}x${h}`,
        Math.max(-rect.x, -rect.y, right(rect) - w, bottom(rect) - h),
      );
    }
  }

  // The column's box ends at its view's bottom edge: the stack's own bottom is the other message properties'.
  const safeOut = Math.max(
    insets.left - column.x,
    right(column) - (w - insets.right),
    insets.top - column.y,
  );
  if (!chk('message-column-inside-safe-area', safeOut <= 1e-9)) {
    fail(
      'message-column-inside-safe-area',
      () => `column ${fmt(column)} insets ${JSON.stringify(insets)}`,
      safeOut,
    );
  }

  if (v.mode === 'replay') {
    const full = topDown.x === 0 && topDown.y === 0 && topDown.width === w && topDown.height === h;
    const none = cockpit === null && views.mirrorLeft === null && views.front === null;
    if (!chk('screen-tiled-by-cockpit-and-top-down', full && none)) {
      fail('screen-tiled-by-cockpit-and-top-down', () => `replay ${fmt(topDown)}`);
    }
    return;
  }
  const einweiser = v.role === 'einweiser';
  if (einweiser) {
    const none = named.every(({ name }) => ['cockpit', 'topDown', 'messageColumn'].includes(name));
    if (!chk('einweiser-has-no-mirrors', cockpit !== null && none)) {
      fail('einweiser-has-no-mirrors', () => named.map(({ name }) => name).join(', '));
    }
  } else {
    const present = cockpit !== null && views.mirrorLeft !== null && views.mirrorRight !== null;
    if (!chk('drive-rects-present', present)) {
      fail('drive-rects-present', () => 'no cockpit or class II mirror in drive');
    }
  }
  if (cockpit === null) return;
  const wheelCode = wheelSize(w, h, insets);
  if (!chk('wheel-size-matches-css', Math.abs(wheelCode - m.wheel) <= 1e-9)) {
    fail(
      'wheel-size-matches-css',
      () => `wheelSize ${wheelCode} px, --ctl-wheel ${m.wheel} px`,
      Math.abs(wheelCode - m.wheel),
    );
  }
  const mirrorsOnly = v.mode === 'mirrors';

  if (mirrorsOnly) {
    const ok =
      topDown.width === 0 &&
      cockpit.x === 0 &&
      cockpit.y === 0 &&
      cockpit.width === w &&
      cockpit.height === h;
    if (!chk('mirror-only-has-no-top-down-pane', ok)) {
      fail(
        'mirror-only-has-no-top-down-pane',
        () => `cockpit ${fmt(cockpit)} topDown ${fmt(topDown)}`,
      );
    }
  } else {
    const tiled = landscape
      ? cockpit.x === 0 &&
        cockpit.y === 0 &&
        cockpit.height === h &&
        topDown.y === 0 &&
        topDown.height === h &&
        topDown.x === cockpit.width &&
        topDown.width > 0 &&
        cockpit.width > 0 &&
        right(topDown) === w
      : topDown.x === 0 &&
        topDown.y === 0 &&
        topDown.width === w &&
        cockpit.x === 0 &&
        cockpit.width === w &&
        cockpit.y === topDown.height &&
        topDown.height > 0 &&
        cockpit.height > 0 &&
        bottom(cockpit) === h;
    if (!chk('screen-tiled-by-cockpit-and-top-down', tiled)) {
      fail(
        'screen-tiled-by-cockpit-and-top-down',
        () => `cockpit ${fmt(cockpit)} topDown ${fmt(topDown)}`,
      );
    }
  }

  /* the split */
  const split: TopDownSplit = topDownSplit(w, h, v.layout, legend?.box ?? null, insets, panels);
  const limits = TOP_DOWN_SHARE_LIMITS[orientationOf(w, h)];
  if (!mirrorsOnly) {
    const within =
      Number.isFinite(split.share) &&
      limits.min <= split.min &&
      split.min <= split.fallback &&
      split.fallback <= split.max &&
      split.max <= limits.max &&
      split.min <= split.share &&
      split.share <= split.max;
    if (!chk('split-within-limits-and-clamp', within)) {
      fail(
        'split-within-limits-and-clamp',
        () => `limits ${limits.min}..${limits.max} split ${JSON.stringify(split)}`,
      );
    }
    const extent = landscape ? w : h;
    const have = landscape ? topDown.width : topDown.height;
    if (!chk('split-matches-top-down-rect', Math.abs(have - split.share * extent) <= 0.5 + 1e-9)) {
      fail(
        'split-matches-top-down-rect',
        () => `pane ${have} px, share ${split.share} of ${extent}`,
        Math.abs(have - split.share * extent) - 0.5,
      );
    }
    if (split.share > split.fallback + 1e-12) {
      const cockpitExtent = landscape ? cockpit.width : cockpit.height;
      const needed = landscape
        ? insets.left + 3 * SPACE_4 + GEARS_W + LEGEND_W + m.wheel
        : COCKPIT_LABEL +
          MIN_MIRROR_HEIGHT +
          MESSAGE_GAP +
          Math.max(controlsHeight(w, h, insets), legend?.box.height ?? 0);
      // a deficit of at most half a pixel is what rounding the pane to whole px leaves; it is a failure all the same
      const deficit = needed - cockpitExtent;
      const room: Property =
        deficit > 0.5 + 1e-9
          ? 'cockpit-keeps-room-for-controls (deficit over 0.5 px)'
          : 'cockpit-keeps-room-for-controls (deficit up to 0.5 px, pane rounding)';
      if (!chk(room, deficit <= 1e-9)) {
        fail(room, () => `cockpit ${cockpitExtent} px, needs ${needed}`, deficit);
      }
    }
  }

  const topInset = cockpit.y === 0 ? insets.top : 0;
  const room = column.width;
  if (
    !chk(
      'message-column-valid',
      finite(column) && column.width > 0 && column.height > 0 && room >= MIN_MESSAGE_WIDTH,
    )
  ) {
    fail(
      'message-column-valid',
      () => `column ${fmt(column)} leaves ${room} px of ${MIN_MESSAGE_WIDTH}`,
      MIN_MESSAGE_WIDTH - room,
    );
  }
  const hudBand: Rect = {
    x: cockpit.x,
    y: cockpit.y + (1 - HUD_BAND_SHARE) * cockpit.height,
    width: cockpit.width,
    height: HUD_BAND_SHARE * cockpit.height,
  };

  if (einweiser) {
    // His messages span his view's top, below the display cut-out (#498 gives them their own place).
    const placed =
      column.y === cockpit.y + topInset &&
      column.x >= cockpit.x + insets.left &&
      right(column) <= right(cockpit) - insets.right + 1e-9;
    if (!chk('message-column-placement', placed)) {
      fail('message-column-placement', () => `column ${fmt(column)} view ${fmt(cockpit)}`);
    }
    const stack: Rect = {
      ...column,
      y: column.y + GEOM.stackTop,
      height: stackHeight(column.width),
    };
    if (!chk('message-stack-clear-of-controls-and-hud-band', !overlaps(stack, hudBand))) {
      fail(
        'message-stack-clear-of-controls-and-hud-band',
        () => `stack ${fmt(stack)} overlaps the HUD band ${fmt(hudBand)}`,
        depth(stack, hudBand),
      );
    }
    return;
  }
  const { mirrorLeft, mirrorRight, wideLeft, wideRight, front, close } = views;
  if (mirrorLeft === null || mirrorRight === null) return;

  /* extras */
  for (const [flag, rects] of [
    [v.extra.front, [front]],
    [v.extra.wide, [wideLeft, wideRight]],
    [v.extra.close, [close]],
  ] as const) {
    if (flag) continue;
    if (
      !chk(
        'extras-only-when-asked',
        rects.every((r) => r === null),
      )
    ) {
      fail('extras-only-when-asked', () => 'a mirror without its flag');
    }
  }

  /* mirrors */
  const mirrors: Named[] = named.filter(
    (n) => n.name !== 'cockpit' && n.name !== 'topDown' && n.name !== 'messageColumn',
  );
  const controls = controlsHeight(w, h, insets);
  const wheel = m.wheel;
  // the wheel and the lever columns each add their 2 px border to the CSS size
  const lever = m.lever + 2;
  const wheelBox: Rect = {
    x: SPACE_4 + insets.left,
    y: h - (SPACE_4 + insets.bottom + LABEL_BLOCK + wheel + 2),
    width: wheel,
    height: SPACE_4 + insets.bottom + LABEL_BLOCK + wheel + 2,
  };
  const gearsBox: Rect = {
    x: m.gearsLeft,
    y: h - SPACE_4 - insets.bottom - GEARS_HEIGHT,
    width: GEARS_W,
    height: SPACE_4 + insets.bottom + GEARS_HEIGHT,
  };
  const pedalsHeight = SPACE_4 + insets.bottom + STOP_BLOCK + STOP_GAP + LABEL_BLOCK + lever;
  const pedalsBox: Rect = {
    x: w - SPACE_4 - insets.right - PEDAL_W,
    y: h - pedalsHeight,
    width: PEDAL_W,
    height: pedalsHeight,
  };
  /** `.hud-action`: the pause button at the screen's top right corner. */
  const pauseBox: Rect = {
    x: w - m.actionRight - GEOM.actionW,
    y: m.actionTop,
    width: GEOM.actionW,
    height: GEOM.actionH,
  };
  const controlBoxes: Named[] = [
    { name: 'wheel', rect: wheelBox },
    { name: 'gears', rect: gearsBox },
    { name: 'stop and lever', rect: pedalsBox },
  ];
  /** `.hud-gear` and `.hud-speed` stand in the HUD band, right of `--hud-inset`. */
  const readouts: Rect = {
    ...hudBand,
    x: m.hudInset,
    width: right(cockpit) - m.hudInset,
  };
  const legendBox: Rect | null =
    legend === null
      ? null
      : {
          x: legend.left,
          y: h - legend.box.height,
          width: legend.width,
          height: legend.box.height,
        };
  const centre = { x: cockpit.x + cockpit.width / 2, y: cockpit.y + cockpit.height / 2 };
  const cone: Rect = {
    x: centre.x - (coneEdge(cockpit.width / cockpit.height, COCKPIT_FOV) * cockpit.width) / 2,
    y: centre.y - (coneTop(COCKPIT_FOV) * cockpit.height) / 2,
    width: coneEdge(cockpit.width / cockpit.height, COCKPIT_FOV) * cockpit.width,
    height: coneTop(COCKPIT_FOV) * cockpit.height,
  };

  for (const { name, rect } of mirrors) {
    const inCockpit =
      rect.x >= cockpit.x &&
      right(rect) <= right(cockpit) &&
      rect.y >= cockpit.y &&
      bottom(rect) <= bottom(cockpit);
    if (!chk('mirrors-inside-cockpit', inCockpit)) {
      fail(
        'mirrors-inside-cockpit',
        () => `${name} ${fmt(rect)} cockpit ${fmt(cockpit)}`,
        Math.max(
          cockpit.x - rect.x,
          right(rect) - right(cockpit),
          cockpit.y - rect.y,
          bottom(rect) - bottom(cockpit),
        ),
      );
    }
    const safeRight = right(cockpit) >= w ? w - insets.right : right(cockpit);
    const safe =
      rect.x >= cockpit.x + insets.left &&
      right(rect) <= safeRight &&
      rect.y >= cockpit.y + topInset;
    if (!chk('mirrors-inside-safe-area', safe)) {
      fail(
        'mirrors-inside-safe-area',
        () => `${name} ${fmt(rect)} insets ${JSON.stringify(insets)}`,
        Math.max(
          cockpit.x + insets.left - rect.x,
          right(rect) - safeRight,
          cockpit.y + topInset - rect.y,
        ),
      );
    }
    const labelEnd = cockpit.y + topInset + COCKPIT_LABEL;
    if (!chk('mirrors-below-cockpit-label', rect.y >= labelEnd)) {
      fail(
        'mirrors-below-cockpit-label',
        () => `${name} top ${rect.y}, label ends ${labelEnd}`,
        labelEnd - rect.y,
      );
    }
    if (mirrorsOnly) {
      const leverEdge = w - SPACE_4 - insets.right - PEDAL_W;
      const ok = !overlaps(rect, pauseBox) && (!landscape || right(rect) <= leverEdge);
      if (!chk('mirror-only-clear-of-pause-button-and-lever', ok)) {
        fail(
          'mirror-only-clear-of-pause-button-and-lever',
          () => `${name} ${fmt(rect)}`,
          Math.max(
            overlaps(rect, pauseBox) ? depth(rect, pauseBox) : 0,
            landscape ? right(rect) - leverEdge : 0,
          ),
        );
      }
    }
    const room = h - controls - bottom(rect);
    // the floor is the escape only for a window with no room left: not 1 px for the mirror with its frame clear
    const atMinimum = rect.height === MIN_SQUEEZED_HEIGHT && h - controls - rect.y - HUD_FRAME < 1;
    const bandProperty = atMinimum
      ? 'mirrors-above-controls-band (height at MIN_SQUEEZED_HEIGHT)'
      : 'mirrors-above-controls-band (frame clear of the controls)';
    // elsewhere the view frame stays clear of the controls too
    const need = atMinimum ? 0 : HUD_FRAME;
    if (!chk(bandProperty, room >= need - 1e-9)) {
      fail(
        bandProperty,
        () =>
          `${name} ${fmt(rect)} leaves ${room} px above the controls (top ${h - controls}), needs ${need}`,
        need - room,
      );
    }
    for (const control of controlBoxes) {
      if (!chk('mirrors-clear-of-control-boxes', !overlaps(rect, control.rect))) {
        fail(
          'mirrors-clear-of-control-boxes',
          () => `${name} ${fmt(rect)} overlaps ${control.name} ${fmt(control.rect)}`,
          depth(rect, control.rect),
        );
      }
    }
    if (!chk('mirrors-above-hud-band', bottom(rect) <= hudBand.y + 1e-9)) {
      fail(
        'mirrors-above-hud-band',
        () => `${name} ${fmt(rect)} reaches ${bottom(rect) - hudBand.y} px into the band`,
        bottom(rect) - hudBand.y,
      );
    }
    if (legendBox !== null && !chk('mirrors-clear-of-legend', !overlaps(rect, legendBox))) {
      fail(
        'mirrors-clear-of-legend',
        () => `${name} ${fmt(rect)} overlaps legend ${fmt(legendBox)}`,
        depth(rect, legendBox),
      );
    }
    // the sight cone is the circle of `CLEAR_CONE_DEG` about the view axis: class IV must not cover it
    // (issue #265), nor class II (issue #392)
    const coneProperty: Property | null =
      name === 'wideLeft' || name === 'wideRight'
        ? 'wide-mirrors-clear-of-sight-cone'
        : name === 'mirrorLeft' || name === 'mirrorRight'
          ? 'class-ii-clear-of-sight-cone'
          : null;
    if (coneProperty !== null) {
      const reach = coneDepth(rect, cockpit);
      if (!chk(coneProperty, reach <= 0)) {
        fail(
          coneProperty,
          () =>
            `${name} ${fmt(rect)} reaches ${reach.toFixed(2)} deg into the ${CLEAR_CONE_DEG} deg cone`,
          reach,
        );
      }
    }
  }

  const disjoint: Named[] = [...mirrors, { name: 'messageColumn', rect: column }];
  for (let i = 0; i < disjoint.length; i++) {
    for (let j = i + 1; j < disjoint.length; j++) {
      const a = disjoint[i];
      const b = disjoint[j];
      if (a === undefined || b === undefined) continue;
      if (!chk('mirrors-and-message-column-disjoint', !overlaps(a.rect, b.rect))) {
        fail(
          'mirrors-and-message-column-disjoint',
          () =>
            `${a.name} ${fmt(a.rect)} and ${b.name} ${fmt(b.rect)} overlap by ${overlapX(a.rect, b.rect)}x${overlapY(a.rect, b.rect)}`,
          depth(a.rect, b.rect),
        );
      }
    }
  }

  /* class IV */
  if (v.extra.wide) {
    const pair = (wideLeft === null) === (wideRight === null);
    if (!chk('class-iv-hangs-under-class-ii', pair))
      fail('class-iv-hangs-under-class-ii', () => 'one side only');
    if (wideLeft !== null && wideRight !== null) {
      for (const [wide, above] of [
        [wideLeft, mirrorLeft],
        [wideRight, mirrorRight],
      ] as const) {
        const ok =
          wide.x === above.x &&
          wide.width === above.width &&
          wide.y - bottom(above) === WIDE_GAP_PX &&
          wide.width >= MIN_WIDE_WIDTH &&
          wide.height === wideHeight(wide.width);
        if (!chk('class-iv-hangs-under-class-ii', ok)) {
          fail('class-iv-hangs-under-class-ii', () => `${fmt(wide)} under ${fmt(above)}`);
        }
      }
      const without = run(legend?.box ?? null, { ...v.extra, wide: false });
      const ref = without.mirrorLeft;
      if (ref !== null) {
        const ok =
          mirrorLeft.width >= MIN_CLASS_II_SHARE * ref.width - 1e-9 &&
          mirrorLeft.height >= MIN_CLASS_II_SHARE * ref.height - 1e-9;
        if (!chk('class-ii-keeps-share-with-class-iv', ok)) {
          fail(
            'class-ii-keeps-share-with-class-iv',
            () => `${mirrorLeft.width}x${mirrorLeft.height} of ${ref.width}x${ref.height}`,
          );
        }
      }
    }
  }

  /* front and close */
  if (front !== null) {
    const ndcX = (2 * (front.x - cockpit.x)) / cockpit.width - 1;
    const ok =
      front.width >= MIN_FRONT_WIDTH &&
      front.width === FRONT_ASPECT * front.height &&
      mirrorRight.x - right(front) >= FRONT_GAP_PX &&
      ndcX >= VISOR.right &&
      !overlaps(front, cone);
    if (!chk('front-mirror-geometry', ok)) {
      fail('front-mirror-geometry', () => `front ${fmt(front)} right mirror ${fmt(mirrorRight)}`);
    }
  }
  if (close !== null) {
    const ok =
      close.width >= MIN_CLOSE_WIDTH &&
      close.width === CLOSE_ASPECT * close.height &&
      close.width <= mirrorRight.width &&
      right(close) === right(mirrorRight) &&
      mirrorRight.y - bottom(close) === WIDE_GAP_PX;
    if (!chk('close-mirror-geometry', ok)) {
      fail('close-mirror-geometry', () => `close ${fmt(close)} right mirror ${fmt(mirrorRight)}`);
    }
  }

  /* messages */
  const inCockpitColumn =
    column.y === cockpit.y + topInset &&
    bottom(column) === bottom(cockpit) &&
    column.x >= cockpit.x &&
    right(column) <= right(cockpit);
  /** The stack in a cockpit column at `x`, `width` wide, and what it overlaps. */
  const cockpitStack = (x: number, width: number, yields: boolean): Rect => ({
    x,
    y: cockpit.y + topInset + GEOM.stackTop,
    width,
    height: stackHeight(width, yields),
  });
  const obstacles: Named[] = [
    { name: 'sight cone', rect: cone },
    ...controlBoxes,
    { name: 'gear and speed readouts', rect: readouts },
    ...(legendBox === null ? [] : [{ name: 'legend', rect: legendBox }]),
    ...mirrors,
    { name: 'action button', rect: pauseBox },
  ];
  // The cue yields only in the mirror-only drive, and only where the span between the mirrors holds not both.
  const limit = (front ?? mirrorRight).x - MESSAGE_GAP;
  const fullFits = (): boolean => {
    const x0 = right(mirrorLeft) + MESSAGE_GAP;
    if (limit - x0 < MIN_MESSAGE_WIDTH) return false;
    const stack = cockpitStack(x0, limit - x0, false);
    return obstacles.every((o) => !overlaps(stack, o.rect));
  };
  const yieldOk = !column.cueYields || (mirrorsOnly && inCockpitColumn && !fullFits());
  if (!chk('message-cue-yields-only-without-room', yieldOk)) {
    fail('message-cue-yields-only-without-room', () => `column ${fmt(column)} yields`);
  }
  if (inCockpitColumn) {
    const placed = column.x >= right(mirrorLeft) + MESSAGE_GAP && right(column) <= limit + 1e-9;
    if (!chk('message-column-placement', placed)) {
      fail(
        'message-column-placement',
        () => `column ${fmt(column)} between ${right(mirrorLeft)} and ${limit}`,
      );
    }
    const stack = cockpitStack(column.x, column.width, column.cueYields);
    if (!chk('message-stack-clear-of-sight-cone', !overlaps(stack, cone))) {
      fail(
        'message-stack-clear-of-sight-cone',
        () => `stack ${fmt(stack)} cone ${fmt(cone)}: ${overlapY(stack, cone)} px deep`,
        depth(stack, cone),
      );
    }
    for (const control of [...controlBoxes, { name: 'gear and speed readouts', rect: readouts }]) {
      if (!chk('message-stack-clear-of-controls-and-hud-band', !overlaps(stack, control.rect))) {
        fail(
          'message-stack-clear-of-controls-and-hud-band',
          () => `stack ${fmt(stack)} overlaps ${control.name} ${fmt(control.rect)}`,
          depth(stack, control.rect),
        );
      }
    }
    if (legendBox !== null && !chk('message-stack-clear-of-legend', !overlaps(stack, legendBox))) {
      fail(
        'message-stack-clear-of-legend',
        () => `stack ${fmt(stack)} overlaps legend ${fmt(legendBox)}`,
        depth(stack, legendBox),
      );
    }
    for (const mirror of mirrors) {
      if (!chk('message-stack-clear-of-mirrors', !overlaps(stack, mirror.rect))) {
        fail(
          'message-stack-clear-of-mirrors',
          () => `stack ${fmt(stack)} overlaps ${mirror.name} ${fmt(mirror.rect)}`,
          depth(stack, mirror.rect),
        );
      }
    }
    if (!chk('message-stack-clear-of-action-button', !overlaps(stack, pauseBox))) {
      fail(
        'message-stack-clear-of-action-button',
        () => `stack ${fmt(stack)} overlaps ${fmt(pauseBox)}`,
        depth(stack, pauseBox),
      );
    }
  } else {
    const placed =
      column.x >= topDown.x &&
      right(column) <= right(topDown) + 1e-9 &&
      column.y >= topDown.y + insets.top + TARGET &&
      bottom(column) <= bottom(topDown) + 1e-9 &&
      (!landscape || right(column) <= w - SPACE_4 - insets.right - PEDAL_W);
    if (!chk('message-column-placement', placed)) {
      fail('message-column-placement', () => `column ${fmt(column)} pane ${fmt(topDown)}`);
    }
    const top = GEOM.stackTop;
    const need = top + stackHeight(column.width);
    if (!chk('message-stack-fits-pane', need <= column.height + 1e-9)) {
      fail(
        'message-stack-fits-pane',
        () => `stack needs ${need} px, column ${fmt(column)}`,
        need - column.height,
      );
    }
    const stack: Rect = { ...column, y: column.y + top, height: need - top };
    if (!chk('message-stack-clear-of-action-button', !overlaps(stack, pauseBox))) {
      fail(
        'message-stack-clear-of-action-button',
        () => `stack ${fmt(stack)} overlaps ${fmt(pauseBox)}`,
        depth(stack, pauseBox),
      );
    }
  }
}

/* ------------------------------------------------------------------------------------------------ */

/** A magnitude as a baseline holds it. */
const shown = (x: number): string => ceil4(x).toFixed(4);
/** Slack for float noise when a worst magnitude is compared with its baseline. */
const EPSILON = 1e-9;

/**
 * One line per property, and under a KNOWN one a line per listed (variant, box) with its numbers against
 * the baseline. A counterexample in a pair of `KNOWN_FINDINGS` is KNOWN and does not fail while every box
 * equals its baseline. A box that fails more often or deeper is WORSE; one that fails less often or milder
 * is BELOW BASELINE, which fails too so that the baseline is lowered and cannot hide a later regression;
 * a pair that is not listed is FAILED. A listed pair without a counterexample is STALE (fixed: remove it).
 * The baselines and STALE hold for the named bounds only: a custom box is classified against the full
 * table and compared with no baseline.
 */
function report(known: KnownTable | null): { summary: string; details: string; failed: boolean } {
  const table = known ?? KNOWN_FINDINGS.full;
  const summary: string[] = [];
  const details: string[] = [];
  let failed = false;
  for (const p of PROPERTIES) {
    const s = stats.get(p);
    if (s === undefined) continue;
    const unit = unitOf(p);
    const listed = table[p] ?? {};
    const rows = [...s.byVariant].map(([name, f]) => {
      const base = listed[name];
      const worse: string[] = [];
      const below: string[] = [];
      if (known !== null && base !== undefined) {
        for (const [box, now] of f.perBox) {
          const was = base.boxes[box];
          if (was === undefined || now.n > was[0] || ceil4(now.worst) > was[1] + EPSILON) {
            worse.push(box);
          }
        }
        for (const [box, was] of Object.entries(base.boxes)) {
          const now = f.perBox.get(box);
          if (worse.includes(box)) continue;
          if (now === undefined || now.n < was[0] || ceil4(now.worst) < was[1] - EPSILON) {
            below.push(box);
          }
        }
      }
      return { name, f, base, worse, below };
    });
    const unknown = rows.filter((r) => r.base === undefined);
    const worse = rows.filter((r) => r.worse.length > 0);
    const below = rows.filter((r) => r.below.length > 0);
    const stale =
      known === null ? [] : Object.keys(listed).filter((name) => !s.byVariant.has(name));
    // two properties count hits of a split-off case: no hit is good; a custom box need not reach every property
    const hitCounter = p.includes('MIN_SQUEEZED_HEIGHT') || p.includes('deficit over');
    const unreached = s.applied === 0 && known !== null && !hitCounter;
    const total = rows.reduce((n, r) => n + r.f.n, 0);
    const issues = [...new Set(rows.flatMap((r) => r.base?.issue ?? []))];
    const status =
      unknown.length > 0
        ? 'FAILED'
        : worse.length > 0
          ? 'WORSE'
          : below.length > 0
            ? 'BELOW BASELINE'
            : stale.length > 0
              ? 'STALE'
              : unreached
                ? 'NEVER APPLIED'
                : s.applied === 0
                  ? 'not applied'
                  : total > 0
                    ? `KNOWN ${issues.join(' ')}`
                    : 'ok';
    if (
      unknown.length > 0 ||
      worse.length > 0 ||
      below.length > 0 ||
      stale.length > 0 ||
      unreached
    ) {
      failed = true;
    }
    summary.push(`${status.padEnd(14)} ${p}  (${total} of ${s.applied} checks failed)`);
    for (const row of rows) {
      const { name, f, base } = row;
      if (base === undefined) continue;
      const names = [...new Set([...f.perBox.keys(), ...Object.keys(base.boxes)])];
      for (const box of names) {
        const now = f.perBox.get(box) ?? { n: 0, worst: 0 };
        const was = base.boxes[box];
        const against = (current: string, baseline: string): string =>
          known === null || was === undefined ? current : `${current} (baseline ${baseline})`;
        const flag = row.worse.includes(box)
          ? '  WORSE'
          : row.below.includes(box)
            ? '  BELOW BASELINE: lower it'
            : '';
        summary.push(
          `    ${base.issue} [${name}] ${box}: ${against(`${now.n} failures`, String(was?.[0]))}, worst ${against(`${shown(now.worst)} ${unit}`, `${was?.[1].toFixed(4)} ${unit}`)}${flag}`,
        );
        const now4 = `${now.n} failures, worst ${shown(now.worst)} ${unit}`;
        const was4 = `${was?.[0]} failures, worst ${was?.[1].toFixed(4)} ${unit}`;
        if (row.worse.includes(box)) {
          details.push(
            `WORSE THAN BASELINE ${p} in variant [${name}], box [${box}] (${base.issue}): ${now4} against ${was4}`,
          );
          for (const e of f.examples) details.push(`  e.g. ${e}`);
        }
        if (row.below.includes(box)) {
          details.push(
            `BELOW BASELINE ${p} in variant [${name}], box [${box}] (${base.issue}): ${now4} against ${was4}; lower the baseline in KNOWN_FINDINGS to the current numbers`,
          );
        }
      }
    }
    for (const { name, f, base } of rows) {
      if (base !== undefined) continue;
      const { w0, w1, h0, h1 } = f.box;
      details.push(
        `FAILED ${p} in variant [${name}]: ${f.n} x, worst ${shown(f.worst)} ${unit}, w ${w0}..${w1}, h ${h0}..${h1}`,
      );
      details.push(
        `  per box: ${[...f.perBox].map(([box, now]) => `${box}=${now.n}/${shown(now.worst)}`).join('; ')}`,
      );
      for (const e of f.examples) details.push(`  e.g. ${e}`);
    }
    for (const name of stale) {
      details.push(
        `STALE ${p} in variant [${name}] (${listed[name]?.issue ?? ''}): no counterexample in these bounds, remove it from KNOWN_FINDINGS`,
      );
    }
    if (unreached) details.push(`NEVER APPLIED ${p}: no check reached it in these bounds`);
  }
  return { summary: summary.join('\n'), details: details.join('\n'), failed };
}

describe('viewport layout, exhaustive over the bounds', () => {
  it('keeps every property at every integer size, for every variant', () => {
    const { boxes, custom } = selection();
    for (const box of boxes) {
      cur.box = box.name;
      for (let w = box.w[0]; w <= box.w[1]; w++) {
        for (let h = box.h[0]; h <= box.h[1]; h++) {
          for (const v of VARIANTS) evaluate(v, w, h);
        }
      }
    }
    const { summary, details, failed } = report(
      custom
        ? null
        : process.env['VERIFY_LAYOUT'] === 'full'
          ? KNOWN_FINDINGS.full
          : KNOWN_FINDINGS.default,
    );
    const bounds = boxes
      .map((b) => `${b.name} ${b.w[0]}..${b.w[1]} x ${b.h[0]}..${b.h[1]}`)
      .join('; ');
    console.log(`bounds: ${bounds}\n${VARIANTS.length} variants\n${summary}`);
    if (failed) throw new Error(`layout properties violated\n${details}`);
  });
});
