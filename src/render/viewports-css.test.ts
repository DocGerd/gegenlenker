/**
 * The CSS the layout code copies, read from the stylesheets: `viewports.verify.ts` (`pnpm verify:layout`)
 * measures against this model, and the tests here fail when `viewports.ts` or `hud.ts` drift from it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { controlsHeight, MIN_MESSAGE_WIDTH, NO_INSETS, wheelSize, type Insets } from './viewports';

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8');
const withoutComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '');

const SOURCE = {
  viewports: read('./viewports.ts'),
  hudTs: read('../hud/hud.ts'),
  layoutSpec: read('../../e2e/layout.spec.ts'),
  tokens: withoutComments(read('../styles/tokens.css')),
  controls: withoutComments(read('../input/controls.css')),
  hud: withoutComments(read('../hud/hud.css')),
};

/** The value of `const NAME = <number>;` in a TypeScript source: `export`, a type annotation and `_` separators allowed. */
function numberConst(source: string, name: string): number {
  const found = new RegExp(
    `(?:^|\\n)\\s*(?:export\\s+)?const\\s+${name}\\s*(?::\\s*number\\s*)?=\\s*(-?[\\d_]*\\.?[\\d_]+)\\s*;`,
  ).exec(source)?.[1];
  const value = Number(found?.replaceAll('_', ''));
  if (found === undefined || !Number.isFinite(value)) throw new Error(`no numeric const ${name}`);
  return value;
}

/* ------------------------------------------------------------------------------------------------
 * A small evaluator of the px lengths in the stylesheets: calc, clamp, min, max, var, px, vmin, vw, vh.
 * ---------------------------------------------------------------------------------------------- */

type Screen = { readonly w: number; readonly h: number; readonly insets: Insets };
type Evaluator = (screen: Screen) => number;

/** Custom properties by name, in source order. */
const DEFINITIONS = new Map<string, string[]>();
for (const text of [SOURCE.tokens, SOURCE.controls, SOURCE.hud]) {
  for (const [, name, value] of text.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;{}]+);/g)) {
    if (name === undefined || value === undefined) continue;
    DEFINITIONS.set(name, [...(DEFINITIONS.get(name) ?? []), value.trim()]);
  }
}

/** Which definition applies per orientation, for the properties that a media query redefines. */
const BY_ORIENTATION: Readonly<Record<string, readonly ['landscape' | 'portrait', ...string[]]>> = {
  '--ctl-wheel': ['portrait', 'landscape'],
  '--ctl-lever-height': ['landscape', 'portrait'],
};

const compiled = new Map<string, Evaluator>();

function definition(name: string, screen: Screen): string {
  const list = DEFINITIONS.get(name) ?? [];
  const order = BY_ORIENTATION[name];
  if (order === undefined) {
    const [only] = list;
    if (list.length !== 1 || only === undefined)
      throw new Error(`${name}: ${list.length} definitions`);
    return only;
  }
  if (list.length !== order.length) throw new Error(`${name}: ${list.length} definitions`);
  const picked = list[order.indexOf(screen.w >= screen.h ? 'landscape' : 'portrait')];
  if (picked === undefined) throw new Error(name);
  return picked;
}

function variable(name: string, screen: Screen): number {
  const side = /^--safe-(top|right|bottom|left)$/.exec(name)?.[1] as keyof Insets | undefined;
  if (side !== undefined) return screen.insets[side];
  return evaluator(definition(name, screen))(screen);
}

const TOKEN = /(\d*\.?\d+)(px|vmin|vw|vh)?|var\(\s*(--[a-z0-9-]+)\s*\)|([a-z]+)\(|([()+\-*/,])/g;

function evaluator(expression: string): Evaluator {
  const cached = compiled.get(expression);
  if (cached !== undefined) return cached;
  const tokens = [...expression.matchAll(TOKEN)];
  if (expression.replace(TOKEN, '').trim() !== '') throw new Error(`cannot parse ${expression}`);
  let at = 0;
  const peek = (): string | undefined => tokens[at]?.[5];
  const take = (symbol: string): void => {
    if (tokens[at]?.[5] !== symbol) throw new Error(`expected ${symbol} in ${expression}`);
    at++;
  };
  const args = (): Evaluator[] => {
    const list = [sum()];
    while (peek() === ',') {
      at++;
      list.push(sum());
    }
    take(')');
    return list;
  };
  const call = (fn: string): Evaluator => {
    const list = args();
    const all = (screen: Screen): number[] => list.map((e) => e(screen));
    switch (fn) {
      case 'calc': {
        const [only] = list;
        if (list.length !== 1 || only === undefined) throw new Error(`calc in ${expression}`);
        return only;
      }
      case 'clamp':
        if (list.length !== 3) throw new Error(`clamp in ${expression}`);
        return (s) => {
          const [low = NaN, value = NaN, high = NaN] = all(s);
          return Math.min(high, Math.max(low, value));
        };
      case 'min':
        return (s) => Math.min(...all(s));
      case 'max':
        return (s) => Math.max(...all(s));
      default:
        throw new Error(`${fn}() in ${expression}`);
    }
  };
  const atom = (): Evaluator => {
    const t = tokens[at++];
    if (t === undefined) throw new Error(`unexpected end of ${expression}`);
    if (t[1] !== undefined) {
      const n = Number(t[1]);
      const unit = t[2];
      if (unit === undefined || unit === 'px') return () => n;
      if (unit === 'vw') return (s) => (n * s.w) / 100;
      if (unit === 'vh') return (s) => (n * s.h) / 100;
      return (s) => (n * Math.min(s.w, s.h)) / 100;
    }
    const name = t[3];
    if (name !== undefined) return (s) => variable(name, s);
    const fn = t[4];
    if (fn !== undefined) return call(fn);
    if (t[5] === '(') {
      const inner = sum();
      take(')');
      return inner;
    }
    throw new Error(`unexpected ${t[0]} in ${expression}`);
  };
  const product = (): Evaluator => {
    let left = atom();
    while (peek() === '*' || peek() === '/') {
      const op = tokens[at++]?.[5];
      const a = left;
      const b = atom();
      left = op === '*' ? (s) => a(s) * b(s) : (s) => a(s) / b(s);
    }
    return left;
  };
  function sum(): Evaluator {
    let left = product();
    while (peek() === '+' || peek() === '-') {
      const op = tokens[at++]?.[5];
      const a = left;
      const b = product();
      left = op === '+' ? (s) => a(s) + b(s) : (s) => a(s) - b(s);
    }
    return left;
  }
  const whole = sum();
  if (at !== tokens.length) throw new Error(`trailing input in ${expression}`);
  compiled.set(expression, whole);
  return whole;
}

const SQUARE: Screen = { w: 1000, h: 1000, insets: NO_INSETS };
/** A length that does not depend on the viewport. */
const px = (expression: string): number => evaluator(expression)(SQUARE);

/* ------------------------------------------------------------------------------------------------
 * Rules.
 * ---------------------------------------------------------------------------------------------- */

const normalised = (selector: string): string => selector.trim().replace(/\s+/g, ' ');

/** The last declaration of `property` in a rule whose selector list has `selector` (source order is the cascade). */
function declared(css: string, selector: string, property: string): string {
  const own = new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;]+)`);
  let found: string | undefined;
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selectors === undefined || body === undefined) continue;
    if (!selectors.split(',').map(normalised).includes(selector)) continue;
    found = own.exec(body)?.[1]?.trim() ?? found;
  }
  if (found === undefined) throw new Error(`no ${property} in ${selector}`);
  return found;
}

/** The space-separated values of a shorthand, split outside parentheses. */
function parts(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const c of value) {
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (/\s/.test(c) && depth === 0) {
      if (current !== '') out.push(current);
      current = '';
    } else current += c;
  }
  if (current !== '') out.push(current);
  return out;
}

/** Vertical and horizontal padding of a rule that sets `padding` to one or two values. */
function padding(css: string, selector: string): { y: number; x: number } {
  const [y, x] = parts(declared(css, selector, 'padding'));
  if (y === undefined) throw new Error(`padding of ${selector}`);
  return { y: px(y), x: px(x ?? y) };
}

const borderWidth = (css: string, selector: string): number => {
  const [width] = parts(declared(css, selector, 'border'));
  if (width === undefined) throw new Error(`border of ${selector}`);
  return px(width);
};

/* ------------------------------------------------------------------------------------------------
 * The model.
 * ---------------------------------------------------------------------------------------------- */

const { controls, hud } = SOURCE;
const TOAST = '.hud-toast';
const CUE = '.hud-goal-cue';
const WRAP = '.hud-toast-wrap';
/** A toast's `max-width` is the column less this much. */
const toastMargin = (): number => {
  const value = declared(hud, TOAST, 'max-width');
  if (!value.includes('100%')) throw new Error(`max-width of ${TOAST}: ${value}`);
  return -px(value.replace('100%', '0px'));
};

/** The control, HUD and message geometry, in CSS px, as the stylesheets give it. */
export const GEOM = {
  space4: px('var(--space-4)'),
  target: px('var(--size-target)'),
  gearsW: px('var(--ctl-gears-w)'),
  legendW: px('var(--hud-legend-w)'),
  /** A control column's label, its padding and the flex gap below it. */
  labelBlock:
    px(declared(controls, '.ctl-label', 'line-height')) +
    2 * padding(controls, '.ctl-label').y +
    px(declared(controls, '.ctl-steer', 'gap')),
  stopBlock: px(declared(controls, '.ctl .ctl-stop', 'min-height')),
  stopGap: px(declared(controls, '.ctl-pedals', 'gap')),
  /** The gear column's height: a browser measurement, which `e2e/layout.spec.ts` pins. */
  gearsHeight: numberConst(SOURCE.layoutSpec, 'GEAR_COLUMN_HEIGHT'),
  /** Where the cockpit label's bottom edge lies; the mirrors keep this much clear below the cockpit's top. */
  cockpitLabel: 32,
  labelBottom:
    px(declared(hud, '.hud-cockpit > .hud-view-label', 'top')) +
    px(declared(hud, '.hud-label', 'line-height')),
  messageLine: px(declared(hud, TOAST, 'line-height')),
  /** A toast or cue box's height beside its lines: padding and borders. */
  messageBox: 2 * padding(hud, TOAST).y + 2 * borderWidth(hud, TOAST),
  stackGap: px(declared(hud, WRAP, 'gap')),
  stackTop: px(parts(declared(hud, WRAP, 'padding'))[0] ?? ''),
  toastMargin: toastMargin(),
  /** A toast's padding and borders, the left one being thicker. */
  toastBox:
    2 * padding(hud, TOAST).x +
    borderWidth(hud, TOAST) +
    px(declared(hud, TOAST, 'border-left-width')),
  cueBox: 2 * padding(hud, CUE).x + 2 * borderWidth(hud, CUE),
  /** The legend stands this far above the HUD band. */
  legendLift: px(declared(hud, '.hud-legend', 'bottom').replace('var(--hud-band)', '0px')),
  /** The lever and the stop button. */
  pedalW: px(declared(controls, '.ctl-lever', 'width')),
  actionW: px('var(--hud-action-w)'),
  actionH: px(declared(hud, '.hud-action', 'min-height')),
} as const;

/** `hud.ts`'s legend states (`legendFor` in `viewports.verify.ts` models them). */
export const HUD_THRESHOLDS = {
  SHORT_SCREEN: 700,
  SHORT_HEIGHT: 740,
  COMPACT_WIDTH: 720,
  COMPACT_WIDTH_WITH_LEVER: 840,
} as const;

/** What depends on the window size and the insets. */
export type Metrics = {
  readonly wheel: number;
  /** `--ctl-lever-height`, before the lever's border. */
  readonly lever: number;
  readonly hudInset: number;
  readonly gearsLeft: number;
  readonly actionTop: number;
  readonly actionRight: number;
};

const GEARS_LEFT = declared(controls, '.ctl-gears', 'left');
const ACTION_TOP = declared(hud, '.hud-action', 'top');
const ACTION_RIGHT = declared(hud, '.hud-action', 'right');
const cache = new Map<Insets, { w: number; h: number; metrics: Metrics }>();

/** The CSS at `w` x `h` with `insets`; the last result per insets object is kept. */
export function metricsAt(w: number, h: number, insets: Insets): Metrics {
  const hit = cache.get(insets);
  if (hit?.w === w && hit.h === h) return hit.metrics;
  const screen: Screen = { w, h, insets };
  const at = (expression: string): number => evaluator(expression)(screen);
  const metrics: Metrics = {
    wheel: at('var(--ctl-wheel)'),
    lever: at('var(--ctl-lever-height)'),
    hudInset: at('var(--hud-inset)'),
    gearsLeft: at(GEARS_LEFT),
    actionTop: at(ACTION_TOP),
    actionRight: at(ACTION_RIGHT),
  };
  cache.set(insets, { w, h, metrics });
  return metrics;
}

/* ------------------------------------------------------------------------------------------------
 * Tests.
 * ---------------------------------------------------------------------------------------------- */

const SIZES: readonly (readonly [number, number])[] = [
  [320, 568],
  [600, 900],
  [820, 1180],
  [1000, 600],
  [1024, 768],
  [1280, 585],
  [1280, 720],
  [1366, 768],
  [1536, 729],
  [1600, 800],
  [1920, 1080],
  [1920, 1200],
  [2560, 1440],
  [900, 900],
  [901, 900],
  [900, 901],
  [700, 1200],
];
const NOTCH: Insets = { top: 24, right: 48, bottom: 20, left: 48 };
const INSETS: readonly Insets[] = [NO_INSETS, { ...NO_INSETS, bottom: 20 }, NOTCH];

describe('the viewports.ts fallbacks match the CSS', () => {
  it('tokenPx fallbacks equal the token values', () => {
    const calls = [
      ...SOURCE.viewports.matchAll(/tokenPx\(\s*'(--[a-z0-9-]+)',\s*([A-Za-z0-9_.]+)\s*\)/g),
    ];
    expect(calls.length).toBeGreaterThan(0);
    for (const [, name, fallback] of calls) {
      if (name === undefined || fallback === undefined) throw new Error('tokenPx call');
      const value = /^[\d.]+$/.test(fallback)
        ? Number(fallback)
        : numberConst(SOURCE.viewports, fallback);
      expect(Number.isFinite(value), `${name} fallback`).toBe(true);
      expect(value, `${name} fallback`).toBe(px(`var(${name})`));
    }
  });

  it('the control constants equal the CSS', () => {
    expect(numberConst(SOURCE.viewports, 'INSET'), 'INSET').toBe(GEOM.space4);
    expect(numberConst(SOURCE.viewports, 'GEARS_WIDTH'), 'GEARS_WIDTH').toBeCloseTo(GEOM.gearsW, 9);
    expect(numberConst(SOURCE.viewports, 'LEGEND_WIDTH'), 'LEGEND_WIDTH').toBe(GEOM.legendW);
    expect(numberConst(SOURCE.viewports, 'LABEL_BLOCK'), 'LABEL_BLOCK').toBe(GEOM.labelBlock);
    expect(numberConst(SOURCE.viewports, 'STOP_BLOCK'), 'STOP_BLOCK').toBe(GEOM.stopBlock);
    expect(numberConst(SOURCE.viewports, 'STOP_GAP'), 'STOP_GAP').toBe(GEOM.stopGap);
    expect(numberConst(SOURCE.viewports, 'GEARS_HEIGHT'), 'GEARS_HEIGHT').toBe(GEOM.gearsHeight);
    expect(numberConst(SOURCE.viewports, 'COCKPIT_LABEL'), 'COCKPIT_LABEL').toBe(GEOM.cockpitLabel);
    expect(numberConst(SOURCE.viewports, 'MESSAGE_LINE'), 'MESSAGE_LINE').toBe(GEOM.messageLine);
    expect(numberConst(SOURCE.viewports, 'MESSAGE_BOX'), 'MESSAGE_BOX').toBe(GEOM.messageBox);
    expect(numberConst(SOURCE.viewports, 'MESSAGE_GAP'), 'MESSAGE_GAP').toBe(GEOM.stackGap);
  });

  it('the cockpit label clears its own height', () => {
    expect(GEOM.cockpitLabel).toBeGreaterThanOrEqual(GEOM.labelBottom);
  });

  it('wheelSize equals --ctl-wheel at every sampled size', () => {
    for (const insets of INSETS) {
      for (const [w, h] of SIZES) {
        expect(wheelSize(w, h, insets), `${w}x${h} left ${insets.left}`).toBeCloseTo(
          metricsAt(w, h, insets).wheel,
          9,
        );
      }
    }
  });

  it('controlsHeight equals the control columns the CSS gives', () => {
    for (const insets of INSETS) {
      for (const [w, h] of SIZES) {
        const m = metricsAt(w, h, insets);
        const base = GEOM.space4 + insets.bottom;
        const steer = base + GEOM.labelBlock + m.wheel + 2;
        const pedals = base + GEOM.stopBlock + GEOM.stopGap + GEOM.labelBlock + m.lever + 2;
        expect(controlsHeight(w, h, insets), `${w}x${h} bottom ${insets.bottom}`).toBeCloseTo(
          w >= h ? steer : Math.max(steer, pedals),
          9,
        );
      }
    }
  });

  it('the message box constants equal the toast and cue rules', () => {
    const margin = GEOM.toastMargin;
    expect(margin).toBe(2 * GEOM.space4);
    expect(GEOM.toastBox).toBe(41);
    expect(GEOM.cueBox).toBe(34);
    expect(MIN_MESSAGE_WIDTH).toBe(131 + GEOM.toastBox + margin);
  });

  it('the safe insets default to zero without a display cut-out', () => {
    for (const side of ['top', 'right', 'bottom', 'left']) {
      expect(DEFINITIONS.get(`--safe-${side}`), `--safe-${side}`).toEqual([
        `env(safe-area-inset-${side}, 0px)`,
      ]);
    }
    expect(NO_INSETS).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });
});

describe('the legend states equal those of hud.ts', () => {
  it.each(Object.entries(HUD_THRESHOLDS))('%s', (name, value) => {
    expect(numberConst(SOURCE.hudTs, name), name).toBe(value);
  });
});
