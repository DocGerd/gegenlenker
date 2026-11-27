/**
 * The CSS the layout code copies, read from the stylesheets: `viewports.verify.ts` (`pnpm verify:layout`)
 * measures against this model, and `viewports-css.test.ts` fails when `viewports.ts` or `hud.ts` drift from it.
 */
import { readFileSync } from 'node:fs';
import { NO_INSETS, type Insets } from './viewports';

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8');
const withoutComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '');

export const SOURCE = {
  viewports: read('./viewports.ts'),
  hudTs: read('../hud/hud.ts'),
  layoutSpec: read('../../e2e/layout.spec.ts'),
  tokens: withoutComments(read('../styles/tokens.css')),
  controls: withoutComments(read('../input/controls.css')),
  hud: withoutComments(read('../hud/hud.css')),
};

/** The value of `const NAME = <number>;` in a TypeScript source: `export`, a type annotation and `_` separators allowed. */
export function numberConst(source: string, name: string): number {
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
export const DEFINITIONS = new Map<string, string[]>();
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

/** A compiled expression: `dim` is 1 for a length and 0 for a plain number; `zero` marks the unitless 0 that CSS lets stand for a length. */
type Node = { readonly run: Evaluator; readonly dim: 0 | 1; readonly zero: boolean };

/**
 * A compiled px length. Rejects what it does not model: other units and functions, a plain number
 * standing as a length (other than 0), and lengths multiplied together.
 */
export function evaluator(expression: string): Evaluator {
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
  /** The dimension of operands that must agree (a sum, the arguments of `min`). */
  const agree = (nodes: readonly Node[]): 0 | 1 => {
    const real = nodes.filter((n) => !n.zero);
    const [first] = real;
    if (first === undefined) return 0;
    if (real.some((n) => n.dim !== first.dim))
      throw new Error(`lengths and numbers mixed in ${expression}`);
    return first.dim;
  };
  const args = (): Node[] => {
    const list = [sum()];
    while (peek() === ',') {
      at++;
      list.push(sum());
    }
    take(')');
    return list;
  };
  const call = (fn: string): Node => {
    const list = args();
    const all = (screen: Screen): number[] => list.map((n) => n.run(screen));
    const dim = agree(list);
    const zero = list.every((n) => n.zero);
    switch (fn) {
      case 'calc': {
        const [only] = list;
        if (list.length !== 1 || only === undefined) throw new Error(`calc in ${expression}`);
        return only;
      }
      case 'clamp':
        if (list.length !== 3) throw new Error(`clamp in ${expression}`);
        // CSS: the minimum wins where it exceeds the maximum
        return {
          run: (s) => {
            const [low = NaN, value = NaN, high = NaN] = all(s);
            return Math.max(low, Math.min(value, high));
          },
          dim,
          zero,
        };
      case 'min':
        return { run: (s) => Math.min(...all(s)), dim, zero };
      case 'max':
        return { run: (s) => Math.max(...all(s)), dim, zero };
      default:
        throw new Error(`${fn}() in ${expression}`);
    }
  };
  const atom = (): Node => {
    const t = tokens[at++];
    if (t === undefined) throw new Error(`unexpected end of ${expression}`);
    if (t[1] !== undefined) {
      const n = Number(t[1]);
      const unit = t[2];
      if (unit === undefined) return { run: () => n, dim: 0, zero: n === 0 };
      if (unit === 'px') return { run: () => n, dim: 1, zero: false };
      if (unit === 'vw') return { run: (s) => (n * s.w) / 100, dim: 1, zero: false };
      if (unit === 'vh') return { run: (s) => (n * s.h) / 100, dim: 1, zero: false };
      return { run: (s) => (n * Math.min(s.w, s.h)) / 100, dim: 1, zero: false };
    }
    const name = t[3];
    if (name !== undefined) return { run: (s) => variable(name, s), dim: 1, zero: false };
    const fn = t[4];
    if (fn !== undefined) return call(fn);
    if (t[5] === '(') {
      const inner = sum();
      take(')');
      return inner;
    }
    throw new Error(`unexpected ${t[0]} in ${expression}`);
  };
  const product = (): Node => {
    let left = atom();
    while (peek() === '*' || peek() === '/') {
      const op = tokens[at++]?.[5];
      const a = left;
      const b = atom();
      if (op === '/' && b.dim !== 0) throw new Error(`division by a length in ${expression}`);
      const dim = a.dim + (op === '*' ? b.dim : 0);
      if (dim > 1) throw new Error(`lengths multiplied in ${expression}`);
      left =
        op === '*'
          ? { run: (s) => a.run(s) * b.run(s), dim: dim as 0 | 1, zero: false }
          : { run: (s) => a.run(s) / b.run(s), dim: dim as 0 | 1, zero: false };
    }
    return left;
  };
  function sum(): Node {
    let left = product();
    while (peek() === '+' || peek() === '-') {
      const op = tokens[at++]?.[5];
      const a = left;
      const b = product();
      const dim = agree([a, b]);
      const zero = a.zero && b.zero;
      left =
        op === '+'
          ? { run: (s) => a.run(s) + b.run(s), dim, zero }
          : { run: (s) => a.run(s) - b.run(s), dim, zero };
    }
    return left;
  }
  const whole = sum();
  if (at !== tokens.length) throw new Error(`trailing input in ${expression}`);
  if (whole.dim !== 1 && !whole.zero) throw new Error(`${expression} is not a length`);
  compiled.set(expression, whole.run);
  return whole.run;
}

const SQUARE: Screen = { w: 1000, h: 1000, insets: NO_INSETS };
const OTHER: Screen = { w: 1234, h: 777, insets: { top: 5, right: 6, bottom: 7, left: 8 } };
/** A length that does not depend on the viewport or the insets; throws where it does. */
export const px = (expression: string): number => {
  const run = evaluator(expression);
  const [a, b] = [run(SQUARE), run(OTHER)];
  if (Math.abs(a - b) > 1e-9) throw new Error(`${expression} depends on the viewport`);
  return a;
};

/* ------------------------------------------------------------------------------------------------
 * Rules.
 * ---------------------------------------------------------------------------------------------- */

const normalised = (selector: string): string => selector.trim().replace(/\s+/g, ' ');

/** The spans of the at-rules (`@media`, ...) in a stylesheet. */
function atRuleSpans(css: string): [number, number][] {
  const spans: [number, number][] = [];
  for (const m of css.matchAll(/@[a-z-]+[^{;]*\{/g)) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    spans.push([m.index, i]);
  }
  return spans;
}

/**
 * The value of `property` in the rules whose selector list has `selector`: the last one outside the
 * at-rules (source order is the cascade; specificity is ignored). Throws where an at-rule also sets it,
 * as the value then depends on the viewport; `base` takes the value outside them anyway.
 */
export function declared(css: string, selector: string, property: string, base = false): string {
  const own = new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;]+)`, 'g');
  const spans = atRuleSpans(css);
  let found: string | undefined;
  let inAtRule = false;
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, selectors, body] = m;
    if (selectors === undefined || body === undefined) continue;
    if (!selectors.split(',').map(normalised).includes(selector)) continue;
    const value = [...body.matchAll(own)].at(-1)?.[1]?.trim();
    if (value === undefined) continue;
    if (spans.some(([from, to]) => m.index >= from && m.index < to)) inAtRule = true;
    else found = value;
  }
  if (inAtRule && !base) throw new Error(`${property} of ${selector} is also set in an at-rule`);
  if (found === undefined) throw new Error(`no ${property} in ${selector}`);
  return found;
}

/** The space-separated values of a shorthand, split outside parentheses. */
export function parts(value: string): string[] {
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

type Sides = { top: string; right: string; bottom: string; left: string };

/** The four sides of a one- to four-value `padding`, as written. */
export function padding(css: string, selector: string): Sides {
  const v = parts(declared(css, selector, 'padding'));
  const [a, b, c, d] = v;
  if (a === undefined || v.length > 4) throw new Error(`padding of ${selector}`);
  return { top: a, right: b ?? a, bottom: c ?? a, left: d ?? b ?? a };
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
const SIGHT = '.hud-sight';
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
    px(padding(controls, '.ctl-label').top) +
    px(padding(controls, '.ctl-label').bottom) +
    px(declared(controls, '.ctl-steer', 'gap')),
  stopBlock: px(declared(controls, '.ctl .ctl-stop', 'min-height')),
  stopGap: px(declared(controls, '.ctl-pedals', 'gap')),
  /** The gear column's height: a browser measurement, which `e2e/layout.spec.ts` pins. */
  gearsHeight: numberConst(SOURCE.layoutSpec, 'GEAR_COLUMN_HEIGHT'),
  /** Where the cockpit label's bottom edge lies; the mirrors keep this much clear below the cockpit's top. */
  cockpitLabel: 32,
  labelBottom:
    px(declared(hud, '.hud-cockpit > .hud-view-label', 'top', true)) +
    px(declared(hud, '.hud-label', 'line-height')),
  messageLine: px(declared(hud, TOAST, 'line-height')),
  /** A toast or cue box's height beside its lines: padding and borders. */
  messageBox:
    px(padding(hud, TOAST).top) + px(padding(hud, TOAST).bottom) + 2 * borderWidth(hud, TOAST),
  stackGap: px(declared(hud, WRAP, 'gap')),
  stackTop: px(padding(hud, WRAP).top),
  toastMargin: toastMargin(),
  /** A toast's padding and borders, the left one being thicker. */
  toastBox:
    px(padding(hud, TOAST).left) +
    px(padding(hud, TOAST).right) +
    borderWidth(hud, TOAST) +
    px(declared(hud, TOAST, 'border-left-width')),
  cueBox: px(padding(hud, CUE).left) + px(padding(hud, CUE).right) + 2 * borderWidth(hud, CUE),
  sightW: px('var(--hud-sight-w)'),
  /** What the sight cue's text leaves of its width: padding, borders, the eye icon and the gap after it. */
  sightChrome:
    px(padding(hud, SIGHT).left) +
    px(padding(hud, SIGHT).right) +
    2 * borderWidth(hud, SIGHT) +
    px(declared(hud, `${SIGHT} svg`, 'width')) +
    px(declared(hud, SIGHT, 'gap')),
  /** The sight cue's height beside its lines, as a toast's. */
  sightBox:
    px(padding(hud, SIGHT).top) + px(padding(hud, SIGHT).bottom) + 2 * borderWidth(hud, SIGHT),
  sightLine: px(declared(hud, SIGHT, 'line-height')),
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
