/**
 * Bounded exhaustive verification of the layout promises of `computeViewports`, `topDownSplit` and
 * `messageColumn` (`pnpm verify:layout`, skill `verify-viewport-layout`). It runs the real code at every
 * integer CSS (width, height) in the bounds below, for a named, sampled list of config variants.
 *
 * The properties come from CLAUDE.md ("Layering"), the doc comments in `viewports.ts` and
 * `expectMessagesClear` in `e2e/layout.spec.ts`, not from what `viewports.test.ts` tolerates. A failure
 * is a counterexample list, never a reason to shrink the bounds or loosen a property.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOP_DOWN_LAYOUT,
  NO_EXTRA_MIRRORS,
  TOP_DOWN_SHARE_LIMITS,
  type ExtraMirrors,
  type GraphicsPreset,
  type LegendBox,
  type Rect,
  type TopDownLayout,
  type TopDownSplit,
  type ViewMode,
  type ViewRects,
} from '../contracts/render';
import { de } from '../i18n/de';
import { en } from '../i18n/en';
import { CLOSE_ASPECT, MIN_CLOSE_WIDTH } from './close-mirror';
import { COCKPIT_FOV, coneEdge, coneTop, FRONT_GAP_PX, VISOR } from './cockpit-band';
import { QUALITY_FLAGS } from './quality';
import {
  computeViewports,
  controlsHeight,
  FRONT_ASPECT,
  HUD_BAND_SHARE,
  MESSAGE_KEYS,
  messageColumn,
  MIN_CLASS_II_SHARE,
  MIN_FRONT_WIDTH,
  MIN_MESSAGE_WIDTH,
  MIN_MIRROR_HEIGHT,
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

/* ------------------------------------------------------------------------------------------------
 * Bounds: every integer CSS width x height in each box. Phones are out of scope (no target).
 * ---------------------------------------------------------------------------------------------- */

type Box = {
  readonly name: string;
  readonly w: readonly [number, number];
  readonly h: readonly [number, number];
};

/**
 * Default: each box is exhaustive, the boxes are not contiguous. Laptops incl. the short ones in
 * CLAUDE.md (1536x729 to 1280x585), 1080p and 1440p desktops, tablets in landscape and portrait.
 */
const DEFAULT_BOXES: readonly Box[] = [
  { name: 'laptop', w: [1280, 1600], h: [585, 800] },
  { name: 'desktop 1080p', w: [1900, 1940], h: [1060, 1100] },
  { name: 'desktop 1440p', w: [2400, 2560], h: [1300, 1440] },
  { name: 'tablet landscape', w: [1000, 1200], h: [600, 800] },
  { name: 'tablet portrait', w: [600, 820], h: [900, 1200] },
];

/** `VERIFY_LAYOUT=full`: every size from the short tablet and laptop to 2560x1440, portrait tablets to 1280x1600. */
const FULL_BOXES: readonly Box[] = [
  { name: 'laptop and desktop', w: [1024, 2560], h: [426, 1440] },
  { name: 'tablet landscape', w: [800, 1023], h: [426, 1000] },
  { name: 'tablet portrait', w: [600, 1280], h: [800, 1600] },
];

const range = (text: string | undefined): readonly [number, number] | null => {
  const m = /^(\d+)-(\d+)$/.exec(text ?? '');
  return m?.[1] !== undefined && m[2] !== undefined ? [Number(m[1]), Number(m[2])] : null;
};

/** `VERIFY_LAYOUT_W=a-b VERIFY_LAYOUT_H=c-d` replaces the boxes with one (for mutation runs and bisecting). */
function boxes(): readonly Box[] {
  const w = range(process.env['VERIFY_LAYOUT_W']);
  const h = range(process.env['VERIFY_LAYOUT_H']);
  if (w !== null && h !== null) return [{ name: 'custom', w, h }];
  return process.env['VERIFY_LAYOUT'] === 'full' ? FULL_BOXES : DEFAULT_BOXES;
}

/* ------------------------------------------------------------------------------------------------
 * CSS geometry the properties are measured against (tokens.css, controls.css, hud.css, e2e).
 * ---------------------------------------------------------------------------------------------- */

const SPACE_4 = 16;
const TARGET = 44;
const GEARS_W = 2.1 * TARGET;
const LEGEND_W = 176;
const LABEL_BLOCK = 30;
const STOP_BLOCK = 55;
const STOP_GAP = 8;
const GEARS_HEIGHT = 274.5;
const COCKPIT_LABEL = 32;
const MESSAGE_GAP = 8;
const MESSAGE_LINE = 22;
const MESSAGE_BOX = 18;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

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
  readonly extra: ExtraMirrors;
  readonly layout: TopDownLayout;
  readonly legend: LegendKind;
  readonly panels: PanelKind;
  readonly insets: Insets;
};

/** What `extraMirrors` (`render/index.ts`) makes of a preset and the class IV setting. */
const extrasOf = (preset: GraphicsPreset, wideSetting: boolean): ExtraMirrors => ({
  front: QUALITY_FLAGS[preset].frontMirror,
  wide: QUALITY_FLAGS[preset].wideMirrors && wideSetting,
  close: QUALITY_FLAGS[preset].closeMirror,
});

const BALANCED = extrasOf('balanced', true);
/** A tablet's home indicator; and a landscape display cut-out (the test values in `viewports.test.ts`). */
const HOME: Insets = { top: 0, right: 0, bottom: 20, left: 0 };
const NOTCH: Insets = { top: 24, right: 48, bottom: 20, left: 48 };
/** The share clamp: stored shares outside the limits (`settings.ts` clamps them, so these are the extremes). */
const SHARE_MIN: TopDownLayout = { landscape: 0, portrait: 0 };
const SHARE_MAX: TopDownLayout = { landscape: 1, portrait: 1 };

const base = (name: string, over: Partial<Omit<Variant, 'name'>>): Variant => ({
  name,
  mode: 'drive',
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
  base('drive low', { extra: extrasOf('low', true) }),
  base('drive high', { extra: extrasOf('high', true) }),
  base('drive balanced, class IV off', { extra: extrasOf('balanced', false) }),
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
    extra: extrasOf('high', true),
    insets: HOME,
    legend: 'measured',
    panels: 'steps',
    layout: SHARE_MAX,
  }),
  base('mirrors balanced', { mode: 'mirrors' }),
  base('mirrors balanced, legend with all keys', { mode: 'mirrors', legend: 'keysOpen' }),
  base('mirrors high, notch, legend', {
    mode: 'mirrors',
    extra: extrasOf('high', true),
    insets: NOTCH,
    legend: 'measured',
  }),
  base('mirrors balanced, home indicator, legend', {
    mode: 'mirrors',
    insets: HOME,
    legend: 'measured',
  }),
  base('replay', { mode: 'replay', extra: NO_EXTRA_MIRRORS }),
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
/** `hud.ts`: below this height a screen is short, below this a cockpit is short, and below these widths it is compact. */
const SHORT_SCREEN = 700;
const SHORT_HEIGHT = 740;
const COMPACT_WIDTH = 720;
const COMPACT_WIDTH_WITH_LEVER = 840;

/* ------------------------------------------------------------------------------------------------
 * Properties, each one named check.
 * ---------------------------------------------------------------------------------------------- */

const PROPERTIES = [
  'rects-finite-positive',
  'rects-inside-viewport',
  'screen-tiled-by-cockpit-and-top-down',
  'mirror-only-has-no-top-down-pane',
  'split-within-limits-and-clamp',
  'split-matches-top-down-rect',
  'cockpit-keeps-room-for-controls (deficit over 0.5 px)',
  'cockpit-keeps-room-for-controls (deficit up to 0.5 px, pane rounding)',
  'extras-only-when-asked',
  'mirrors-inside-cockpit',
  'mirrors-inside-safe-area',
  'mirrors-below-cockpit-label',
  'mirror-only-clear-of-pause-button-and-lever',
  'mirrors-above-controls-band (height above minimum)',
  'mirrors-above-controls-band (height at MIN_MIRROR_HEIGHT)',
  'mirrors-clear-of-control-boxes',
  'mirrors-above-hud-band',
  'mirrors-clear-of-legend',
  'mirrors-clear-of-sight-cone',
  'mirrors-and-message-column-disjoint',
  'class-iv-hangs-under-class-ii',
  'class-ii-keeps-share-with-class-iv',
  'front-mirror-geometry',
  'close-mirror-geometry',
  'message-column-valid',
  'message-column-placement',
  'message-stack-fits-pane',
  'message-stack-clear-of-sight-cone',
  'message-stack-clear-of-controls-and-hud-band',
  'message-stack-clear-of-legend',
  'message-stack-clear-of-mirrors',
] as const;
type Property = (typeof PROPERTIES)[number];

type Stat = {
  applied: number;
  failed: number;
  examples: string[];
  byVariant: Map<string, number>;
  box: { w0: number; w1: number; h0: number; h1: number };
};
const EXAMPLES = 4;

const stats = new Map<Property, Stat>(
  PROPERTIES.map((p) => [
    p,
    {
      applied: 0,
      failed: 0,
      examples: [],
      byVariant: new Map(),
      box: { w0: Infinity, w1: -Infinity, h0: Infinity, h1: -Infinity },
    },
  ]),
);
const cur = { variant: '', w: 0, h: 0 };

/** Counts an evaluation of `p` and returns whether it held; the caller reports the detail only on failure. */
function chk(p: Property, held: boolean): boolean {
  const s = stats.get(p);
  if (s === undefined) throw new Error(p);
  s.applied++;
  return held;
}

function fail(p: Property, detail: () => string): void {
  const s = stats.get(p);
  if (s === undefined) throw new Error(p);
  s.failed++;
  s.byVariant.set(cur.variant, (s.byVariant.get(cur.variant) ?? 0) + 1);
  s.box.w0 = Math.min(s.box.w0, cur.w);
  s.box.w1 = Math.max(s.box.w1, cur.w);
  s.box.h0 = Math.min(s.box.h0, cur.h);
  s.box.h1 = Math.max(s.box.h1, cur.h);
  if (s.examples.length < EXAMPLES)
    s.examples.push(`${cur.w}x${cur.h} [${cur.variant}] ${detail()}`);
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
const fmt = (r: Rect): string => `(${r.x},${r.y} ${r.width}x${r.height})`;

/* Message stack: toast, gap, goal cue, as `expectMessagesClear` measures them (hud.css `.hud-toast`). */
const toastTexts: readonly string[] = [en, de].flatMap((lang) =>
  MESSAGE_KEYS.toast.map((key) => lang[key]),
);
/** The goal cue shows the distance before the angle verdict. */
const cueTexts: readonly string[] = [en, de].flatMap((lang) => [
  lang.goalInside,
  lang.goalPositionOk,
  `${lang.goalDistance} ${lang.goalAngleOk}`,
  `${lang.goalDistance} ${lang.goalAngleOff}`,
]);
const mostLines = (texts: readonly string[], width: number): number =>
  Math.max(...texts.map((text) => wrapLines(text, width)));
const stackCache = new Map<number, number>();
/** Height of the longest toast, the gap and the goal cue in a column `room` px wide (left inset taken off). */
function stackHeight(room: number): number {
  const known = stackCache.get(room);
  if (known !== undefined) return known;
  // toast: its max-width leaves 32 px, padding and borders take 41; cue: padding and borders take 34
  const toast = mostLines(toastTexts, room - 32 - 41) * MESSAGE_LINE + MESSAGE_BOX;
  const cue = mostLines(cueTexts, room - 34) * MESSAGE_LINE + MESSAGE_BOX;
  const total = toast + MESSAGE_GAP + cue;
  stackCache.set(room, total);
  return total;
}

type Named = { readonly name: string; readonly rect: Rect };

/**
 * The key legend as `hud.ts` shows it at this size, with the largest of its measured boxes (headless
 * Chromium, en and de, at 600x1062 to 2560x1440; `LEGEND_BOXES`). Null where it is hidden.
 */
function legendFor(
  kind: LegendKind,
  mode: Mode,
  views: ViewRects,
  w: number,
  h: number,
  insets: Insets,
): { box: LegendBox; left: number; width: number } | null {
  const { cockpit } = views;
  if (kind === 'none' || cockpit === null) return null;
  if (mode === 'mirrors' && w < h) return null;
  const compact = cockpit.width < (right(cockpit) >= w ? COMPACT_WIDTH_WITH_LEVER : COMPACT_WIDTH);
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
  const left = 3 * SPACE_4 + wheelSize(w, h, insets) + GEARS_W + insets.left;
  const lift = HUD_BAND_SHARE * cockpit.height + 12;
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
  const panels = panelsOf(v);
  const run = (legend: LegendBox | null, extra: ExtraMirrors): ViewRects =>
    computeViewports(w, h, v.mode, legend, insets, v.layout, panels, extra);

  const first = run(null, v.extra);
  const legend = legendFor(v.legend, v.mode, first, w, h, insets);
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
  const column = messageColumn(views, insets);
  add('messageColumn', column);

  for (const { name, rect } of named) {
    const sane =
      finite(rect) &&
      rect.width >= 0 &&
      rect.height >= 0 &&
      !(rect.width === 0 && name !== 'topDown');
    if (!chk('rects-finite-positive', sane))
      fail('rects-finite-positive', () => `${name} ${fmt(rect)}`);
    const inside =
      rect.x >= 0 && rect.y >= 0 && right(rect) <= w + 1e-9 && bottom(rect) <= h + 1e-9;
    if (!chk('rects-inside-viewport', inside)) {
      fail('rects-inside-viewport', () => `${name} ${fmt(rect)} in ${w}x${h}`);
    }
  }

  if (v.mode === 'replay') {
    const full = topDown.x === 0 && topDown.y === 0 && topDown.width === w && topDown.height === h;
    const none = cockpit === null && views.mirrorLeft === null && views.front === null;
    if (!chk('screen-tiled-by-cockpit-and-top-down', full && none)) {
      fail('screen-tiled-by-cockpit-and-top-down', () => `replay ${fmt(topDown)}`);
    }
    return;
  }
  if (cockpit === null || views.mirrorLeft === null || views.mirrorRight === null) {
    fail('rects-finite-positive', () => 'no cockpit or class II mirror in drive');
    return;
  }
  const { mirrorLeft, mirrorRight, wideLeft, wideRight, front, close } = views;
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
      );
    }
    if (split.share > split.fallback + 1e-12) {
      const cockpitExtent = landscape ? cockpit.width : cockpit.height;
      const needed = landscape
        ? insets.left + 3 * SPACE_4 + GEARS_W + LEGEND_W + wheelSize(w, h, insets)
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
        fail(room, () => `cockpit ${cockpitExtent} px, needs ${needed}`);
      }
    }
  }

  /* extras */
  for (const [flag, rects] of [
    [v.extra.front, [front]],
    [v.extra.wide, [wideLeft, wideRight]],
    [v.extra.close, [close]],
  ] as const) {
    if (
      !flag &&
      !chk(
        'extras-only-when-asked',
        rects.every((r) => r === null),
      )
    ) {
      fail('extras-only-when-asked', () => 'a mirror without its flag');
    } else if (flag) chk('extras-only-when-asked', true);
  }

  /* mirrors */
  const mirrors: Named[] = named.filter(
    (n) => n.name !== 'cockpit' && n.name !== 'topDown' && n.name !== 'messageColumn',
  );
  const topInset = cockpit.y === 0 ? insets.top : 0;
  const controls = controlsHeight(w, h, insets);
  const wheel = wheelSize(w, h, insets);
  const lever = clamp((landscape ? 0.38 : 0.24) * Math.min(w, h), 160, landscape ? 280 : 240) + 2;
  const wheelBox: Rect = {
    x: SPACE_4 + insets.left,
    y: h - (SPACE_4 + insets.bottom + LABEL_BLOCK + wheel + 2),
    width: wheel,
    height: SPACE_4 + insets.bottom + LABEL_BLOCK + wheel + 2,
  };
  const gearsBox: Rect = {
    x: 2 * SPACE_4 + wheel + insets.left,
    y: h - SPACE_4 - insets.bottom - GEARS_HEIGHT,
    width: GEARS_W,
    height: SPACE_4 + insets.bottom + GEARS_HEIGHT,
  };
  const pedalsHeight = SPACE_4 + insets.bottom + STOP_BLOCK + STOP_GAP + LABEL_BLOCK + lever;
  const pedalsBox: Rect = {
    x: w - SPACE_4 - insets.right - 1.5 * TARGET,
    y: h - pedalsHeight,
    width: 1.5 * TARGET,
    height: pedalsHeight,
  };
  /** `.hud-action`: the pause button at the screen's top right corner, 96 px wide (`--hud-action-w`). */
  const pauseBox: Rect = {
    x: w - SPACE_4 - insets.right - 96,
    y: SPACE_4 + insets.top,
    width: 96,
    height: TARGET,
  };
  const controlBoxes: Named[] = [
    { name: 'wheel', rect: wheelBox },
    { name: 'gears', rect: gearsBox },
    { name: 'stop and lever', rect: pedalsBox },
  ];
  const hudBand: Rect = {
    x: cockpit.x,
    y: cockpit.y + (1 - HUD_BAND_SHARE) * cockpit.height,
    width: cockpit.width,
    height: HUD_BAND_SHARE * cockpit.height,
  };
  /** `.hud-gear` and `.hud-speed` stand in the HUD band, right of `--hud-inset`. */
  const readouts: Rect = {
    ...hudBand,
    x: 3 * SPACE_4 + wheel + GEARS_W + insets.left,
    width: right(cockpit) - (3 * SPACE_4 + wheel + GEARS_W + insets.left),
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
      fail('mirrors-inside-cockpit', () => `${name} ${fmt(rect)} cockpit ${fmt(cockpit)}`);
    }
    const safe =
      rect.x >= cockpit.x + insets.left &&
      right(rect) <= (right(cockpit) >= w ? w - insets.right : right(cockpit)) &&
      rect.y >= cockpit.y + topInset;
    if (!chk('mirrors-inside-safe-area', safe)) {
      fail(
        'mirrors-inside-safe-area',
        () => `${name} ${fmt(rect)} insets ${JSON.stringify(insets)}`,
      );
    }
    if (!chk('mirrors-below-cockpit-label', rect.y >= cockpit.y + topInset + COCKPIT_LABEL)) {
      fail(
        'mirrors-below-cockpit-label',
        () => `${name} top ${rect.y}, label ends ${cockpit.y + topInset + COCKPIT_LABEL}`,
      );
    }
    if (mirrorsOnly) {
      const ok =
        !overlaps(rect, pauseBox) &&
        (!landscape || right(rect) <= w - SPACE_4 - insets.right - 1.5 * TARGET);
      if (!chk('mirror-only-clear-of-pause-button-and-lever', ok)) {
        fail('mirror-only-clear-of-pause-button-and-lever', () => `${name} ${fmt(rect)}`);
      }
    }
    const room = h - controls - bottom(rect);
    const atMinimum = rect.height === MIN_MIRROR_HEIGHT;
    const bandProperty = atMinimum
      ? 'mirrors-above-controls-band (height at MIN_MIRROR_HEIGHT)'
      : 'mirrors-above-controls-band (height above minimum)';
    if (!chk(bandProperty, room >= -1e-9)) {
      fail(
        bandProperty,
        () => `${name} ${fmt(rect)} reaches ${-room} px into the controls (top ${h - controls})`,
      );
    }
    for (const control of controlBoxes) {
      if (!chk('mirrors-clear-of-control-boxes', !overlaps(rect, control.rect))) {
        fail(
          'mirrors-clear-of-control-boxes',
          () => `${name} ${fmt(rect)} overlaps ${control.name} ${fmt(control.rect)}`,
        );
      }
    }
    if (!chk('mirrors-above-hud-band', bottom(rect) <= hudBand.y + 1e-9)) {
      fail(
        'mirrors-above-hud-band',
        () => `${name} ${fmt(rect)} reaches ${bottom(rect) - hudBand.y} px into the band`,
      );
    }
    if (legendBox !== null && !chk('mirrors-clear-of-legend', !overlaps(rect, legendBox))) {
      fail(
        'mirrors-clear-of-legend',
        () => `${name} ${fmt(rect)} overlaps legend ${fmt(legendBox)}`,
      );
    }
    if (!chk('mirrors-clear-of-sight-cone', !overlaps(rect, cone))) {
      fail('mirrors-clear-of-sight-cone', () => `${name} ${fmt(rect)} overlaps cone ${fmt(cone)}`);
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
    column.y === cockpit.y &&
    column.height === cockpit.height &&
    column.x >= cockpit.x &&
    right(column) <= right(cockpit);
  const room = inCockpitColumn ? column.width - insets.left : column.width;
  if (
    !chk(
      'message-column-valid',
      finite(column) && column.width > 0 && column.height > 0 && room >= MIN_MESSAGE_WIDTH,
    )
  ) {
    fail(
      'message-column-valid',
      () => `column ${fmt(column)} leaves ${room} px of ${MIN_MESSAGE_WIDTH}`,
    );
  }
  if (inCockpitColumn) {
    const limit = (front ?? mirrorRight).x - MESSAGE_GAP;
    const placed = column.x >= right(mirrorLeft) + MESSAGE_GAP && right(column) <= limit + 1e-9;
    if (!chk('message-column-placement', placed)) {
      fail(
        'message-column-placement',
        () => `column ${fmt(column)} between ${right(mirrorLeft)} and ${limit}`,
      );
    }
    const stack: Rect = {
      x: column.x + insets.left,
      y: cockpit.y + SPACE_4 + (landscape ? insets.top : 0),
      width: column.width - insets.left,
      height: stackHeight(column.width - insets.left),
    };
    if (!chk('message-stack-clear-of-sight-cone', !overlaps(stack, cone))) {
      fail(
        'message-stack-clear-of-sight-cone',
        () => `stack ${fmt(stack)} cone ${fmt(cone)}: ${overlapY(stack, cone)} px deep`,
      );
    }
    for (const control of [...controlBoxes, { name: 'gear and speed readouts', rect: readouts }]) {
      if (!chk('message-stack-clear-of-controls-and-hud-band', !overlaps(stack, control.rect))) {
        fail(
          'message-stack-clear-of-controls-and-hud-band',
          () => `stack ${fmt(stack)} overlaps ${control.name} ${fmt(control.rect)}`,
        );
      }
    }
    if (legendBox !== null && !chk('message-stack-clear-of-legend', !overlaps(stack, legendBox))) {
      fail(
        'message-stack-clear-of-legend',
        () => `stack ${fmt(stack)} overlaps legend ${fmt(legendBox)}`,
      );
    }
    for (const m of mirrors) {
      if (!chk('message-stack-clear-of-mirrors', !overlaps(stack, m.rect))) {
        fail(
          'message-stack-clear-of-mirrors',
          () => `stack ${fmt(stack)} overlaps ${m.name} ${fmt(m.rect)}`,
        );
      }
    }
  } else {
    const placed =
      column.x >= topDown.x &&
      right(column) <= right(topDown) + 1e-9 &&
      column.y >= topDown.y + TARGET &&
      bottom(column) <= bottom(topDown) + 1e-9 &&
      (!landscape || right(column) <= w - SPACE_4 - insets.right - 1.5 * TARGET);
    if (!chk('message-column-placement', placed)) {
      fail('message-column-placement', () => `column ${fmt(column)} pane ${fmt(topDown)}`);
    }
    const need = SPACE_4 + stackHeight(column.width - insets.left);
    if (!chk('message-stack-fits-pane', need <= column.height + 1e-9)) {
      fail('message-stack-fits-pane', () => `stack needs ${need} px, column ${fmt(column)}`);
    }
  }
}

/* ------------------------------------------------------------------------------------------------ */

/** One line per property, and for each failed one its failing region, variants and first counterexamples. */
function report(custom: boolean): { summary: string; details: string; failed: boolean } {
  const summary: string[] = [];
  const details: string[] = [];
  let failed = false;
  for (const p of PROPERTIES) {
    const s = stats.get(p);
    if (s === undefined) continue;
    const status = s.applied === 0 ? 'NEVER APPLIED' : s.failed === 0 ? 'ok' : 'FAILED';
    // two properties count hits of a split-off case: no hit is good; a custom box need not reach every property
    const hitCounter = p.includes('MIN_MIRROR_HEIGHT') || p.includes('deficit over');
    if (s.failed > 0 || (s.applied === 0 && !custom && !hitCounter)) failed = true;
    summary.push(`${status.padEnd(13)} ${p}  (${s.failed} of ${s.applied} checks failed)`);
    if (s.failed > 0) {
      const { w0, w1, h0, h1 } = s.box;
      details.push(`${p}: failing sizes lie in w ${w0}..${w1}, h ${h0}..${h1}`);
      for (const [name, n] of [...s.byVariant].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
        details.push(`  ${n} x in variant [${name}]`);
      }
      for (const e of s.examples) details.push(`  e.g. ${e}`);
    }
  }
  return { summary: summary.join('\n'), details: details.join('\n'), failed };
}

describe('viewport layout, exhaustive over the bounds', () => {
  it('keeps every property at every integer size, for every variant', () => {
    for (const box of boxes()) {
      for (let w = box.w[0]; w <= box.w[1]; w++) {
        for (let h = box.h[0]; h <= box.h[1]; h++) {
          for (const v of VARIANTS) evaluate(v, w, h);
        }
      }
    }
    const { summary, details, failed } = report(process.env['VERIFY_LAYOUT_W'] !== undefined);
    const bounds = boxes()
      .map((b) => `${b.name} ${b.w[0]}..${b.w[1]} x ${b.h[0]}..${b.h[1]}`)
      .join('; ');
    console.log(`bounds: ${bounds}\n${VARIANTS.length} variants\n${summary}`);
    if (failed) throw new Error(`layout properties violated\n${details}`);
  });
});

/* The node fallbacks stand in for the CSS that a browser reads; they must equal it. */
describe('viewports.ts fallbacks match the CSS', () => {
  const read = (relative: string): string =>
    readFileSync(new URL(relative, import.meta.url), 'utf8');
  const source = read('./viewports.ts');
  const tokens = read('../styles/tokens.css');
  const controlsCss = read('../input/controls.css');
  const cssPx = (name: string): number => {
    const m = new RegExp(`${name}:\\s*([\\d.]+)px`).exec(tokens);
    if (m?.[1] === undefined) throw new Error(`no ${name} in tokens.css`);
    return Number(m[1]);
  };

  it('tokenPx fallbacks equal the token values', () => {
    const calls = [...source.matchAll(/tokenPx\('(--[a-z0-9-]+)',\s*([A-Za-z0-9_.]+)\)/g)];
    expect(calls.length).toBeGreaterThan(0);
    const named = new Map<string, number>([['INSET', SPACE_4]]);
    for (const [, name, fallback] of calls) {
      if (name === undefined || fallback === undefined) throw new Error('call');
      const value = named.get(fallback) ?? Number(fallback);
      expect(value, `${name} fallback`).toBe(cssPx(name));
    }
  });

  it('INSET and the control geometry equal the CSS', () => {
    expect(Number(/const INSET = (\d+);/.exec(source)?.[1])).toBe(cssPx('--space-4'));
    expect(Number(/const GEARS_WIDTH = ([\d.]+);/.exec(source)?.[1])).toBeCloseTo(
      2.1 * cssPx('--size-target'),
      9,
    );
    expect(Number(/const LEGEND_WIDTH = (\d+);/.exec(source)?.[1])).toBe(cssPx('--hud-legend-w'));
    expect(tokens).toContain('--ctl-wheel: clamp(160px, 38vmin, 300px);');
    expect(source).toContain('clamp(0.38 * Math.min(cssWidth, cssHeight), 160, 300)');
    expect(source).toContain('const MIN_NARROW_WHEEL = 148;');
    expect(tokens).toContain('max(\n        148px,\n        60vw');
    expect(source).toContain('0.6 * cssWidth');
    expect(controlsCss).toContain('--ctl-lever-height: clamp(160px, 24vmin, 240px);');
    expect(source).toContain('clamp(0.24 * vmin, 160, 240)');
  });

  it('the legend thresholds equal those of hud.ts', () => {
    const hud = read('../hud/hud.ts');
    for (const [name, value] of [
      ['SHORT_SCREEN', SHORT_SCREEN],
      ['SHORT_HEIGHT', SHORT_HEIGHT],
      ['COMPACT_WIDTH', COMPACT_WIDTH],
      ['COMPACT_WIDTH_WITH_LEVER', COMPACT_WIDTH_WITH_LEVER],
    ] as const) {
      expect(Number(new RegExp(`const ${name} = (\\d+);`).exec(hud)?.[1]), name).toBe(value);
    }
  });

  it('the safe insets default to zero without a display cut-out', () => {
    for (const side of ['top', 'right', 'bottom', 'left']) {
      expect(tokens).toContain(`--safe-${side}: env(safe-area-inset-${side}, 0px);`);
    }
    expect(NO_INSETS).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });
});
