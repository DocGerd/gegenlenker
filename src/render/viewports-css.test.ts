/**
 * The layout code's copies of CSS and `hud.ts` constants against the stylesheets (`viewports-css.ts`
 * reads them). `pnpm verify:layout` runs these too: its sweep measures against the same CSS.
 */
import { describe, expect, it } from 'vitest';
import {
  declared,
  DEFINITIONS,
  evaluator,
  GEOM,
  HUD_THRESHOLDS,
  metricsAt,
  numberConst,
  padding,
  px,
  SOURCE,
} from './viewports-css';
import {
  controlsHeight,
  MIN_MESSAGE_WIDTH,
  NO_INSETS,
  SIGHT_CUE_WIDTH,
  wheelSize,
  type Insets,
} from './viewports';

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
    // a call with a fallback the pattern cannot read must not slip by
    expect(calls.length, 'tokenPx calls parsed').toBe(
      (SOURCE.viewports.match(/tokenPx\(\s*'/g) ?? []).length,
    );
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
    expect(numberConst(SOURCE.viewports, 'LEGEND_LIFT'), 'LEGEND_LIFT').toBe(GEOM.legendLift);
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
    expect(MIN_MESSAGE_WIDTH).toBe(99 + GEOM.toastBox + margin);
  });

  it('the sight cue constants equal its rule, which sets its text as the toasts do', () => {
    expect(SIGHT_CUE_WIDTH).toBe(GEOM.sightW);
    expect(numberConst(SOURCE.viewports, 'SIGHT_CUE_CHROME')).toBe(GEOM.sightChrome);
    expect([GEOM.sightBox, GEOM.sightLine]).toEqual([GEOM.messageBox, GEOM.messageLine]);
    for (const property of ['font-size', 'font-weight']) {
      expect(declared(SOURCE.hud, '.hud-sight', property), property).toBe(
        declared(SOURCE.hud, '.hud-toast', property),
      );
    }
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

describe('the CSS evaluator rejects what it does not model', () => {
  const screen = { w: 1000, h: 800, insets: NO_INSETS };

  it('a plain number is not a length, but 0 is', () => {
    expect(() => evaluator('12')).toThrow();
    expect(() => evaluator('calc(2px + 3)')).toThrow();
    expect(evaluator('0')(screen)).toBe(0);
    expect(evaluator('calc(2 * 3px)')(screen)).toBe(6);
  });

  it('lengths are not multiplied together', () => {
    expect(() => evaluator('calc(2px * 3px)')).toThrow();
  });

  it('other units are not read', () => {
    expect(() => evaluator('3em')).toThrow();
    expect(() => evaluator('50%')).toThrow();
  });

  it('clamp returns the minimum where it exceeds the maximum', () => {
    expect(evaluator('clamp(50px, 10px, 20px)')(screen)).toBe(50);
    expect(evaluator('clamp(10px, 15px, 20px)')(screen)).toBe(15);
  });

  it('px throws for a length that depends on the viewport', () => {
    expect(() => px('10vmin')).toThrow();
    expect(() => px('var(--safe-left)')).toThrow();
    expect(px('var(--space-4)')).toBe(GEOM.space4);
  });

  it('declared throws where an at-rule also sets the property, unless asked for the base', () => {
    const css = '.a { top: 1px; }\n@media (min-aspect-ratio: 1/1) { .a { top: 2px; } }';
    expect(() => declared(css, '.a', 'top')).toThrow();
    expect(declared(css, '.a', 'top', true)).toBe('1px');
    expect(declared('.b { gap: 1px; gap: 2px; }', '.b', 'gap')).toBe('2px');
  });

  it('padding reads one to four values and rejects the rest', () => {
    expect(padding('.a { padding: 1px 2px 3px; }', '.a')).toEqual({
      top: '1px',
      right: '2px',
      bottom: '3px',
      left: '2px',
    });
    expect(padding('.a { padding: 1px; }', '.a').left).toBe('1px');
    expect(() => padding('.a { padding: 1px 2px 3px 4px 5px; }', '.a')).toThrow();
  });
});
