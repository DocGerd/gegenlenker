import { describe, expect, it } from 'vitest';
import { DEFAULT_TOP_DOWN_LAYOUT, type Rect } from '../contracts/render';
import { de } from '../i18n/de';
import { en } from '../i18n/en';
import { COCKPIT_FOV, coneTop, CONE_GAP, FRONT_GAP_PX, frontBand, VISOR } from './cockpit-band';
import {
  computeViewports,
  controlsHeight,
  FRONT_ASPECT,
  messageColumn,
  MESSAGE_KEYS,
  MIN_FRONT_WIDTH,
  MIN_MESSAGE_WIDTH,
  SPACE_PX,
  wordPx,
  wrapLines,
  MIN_CLASS_II_SHARE,
  MIN_MIRROR_HEIGHT,
  MIN_WIDE_HEIGHT,
  MIN_WIDE_WIDTH,
  NO_INSETS,
  WIDE_ASPECT,
  WIDE_GAP_PX,
  wideHeight,
  topDownSplit,
  wheelSize,
  type Insets,
  type PanelStack,
} from './viewports';

describe('computeViewports mirrors', () => {
  it('stay inside the cockpit and above the controls at every size', () => {
    for (let w = 320; w <= 2000; w += 20) {
      for (let h = 320; h <= 2000; h += 20) {
        const { cockpit, mirrorLeft, mirrorRight } = computeViewports(w, h, 'drive');
        if (cockpit === null || mirrorLeft === null || mirrorRight === null) {
          throw new Error('drive mode has mirrors');
        }
        for (const m of [mirrorLeft, mirrorRight]) {
          const at = `${w}x${h}`;
          expect(m.x, at).toBeGreaterThanOrEqual(cockpit.x);
          expect(m.x + m.width, at).toBeLessThanOrEqual(cockpit.x + cockpit.width);
          expect(m.y, at).toBeGreaterThanOrEqual(cockpit.y);
          expect(m.y + m.height, at).toBeLessThanOrEqual(cockpit.y + cockpit.height);
          expect(m.width, at).toBeGreaterThan(0);
          // With no room for the minimum height, the mirror keeps that size instead.
          if (m.height !== MIN_MIRROR_HEIGHT) {
            expect(m.y + m.height, at).toBeLessThanOrEqual(h - controlsHeight(w, h));
          }
        }
      }
    }
  });
});

describe('computeViewports key legend', () => {
  it('keeps the mirrors above a legend that reaches under them', () => {
    for (let w = 320; w <= 2000; w += 20) {
      for (let h = 320; h <= 2000; h += 20) {
        const { cockpit } = computeViewports(w, h, 'drive');
        if (cockpit === null) throw new Error('drive mode has a cockpit');
        for (const right of [cockpit.x + 300, cockpit.x + cockpit.width - 40]) {
          const legend = { right, height: 260 };
          // The legend starts right of the left mirror, so only the right one can sit over it.
          const { mirrorRight: m } = computeViewports(w, h, 'drive', legend);
          if (m === null) throw new Error('drive mode has mirrors');
          if (m.x < legend.right && m.height !== MIN_MIRROR_HEIGHT) {
            expect(m.y + m.height, `${w}x${h} legend to ${right}`).toBeLessThanOrEqual(
              h - legend.height,
            );
          }
        }
      }
    }
  });

  it('leaves the mirrors alone when the legend ends before them', () => {
    const base = computeViewports(1280, 720, 'drive');
    const legend = { right: (base.mirrorRight?.x ?? 0) - 1, height: 260 };
    expect(computeViewports(1280, 720, 'drive', legend)).toEqual(base);
  });
});

describe('computeViewports safe-area insets', () => {
  const insets = { top: 24, right: 48, bottom: 20, left: 48 };

  it('keep the mirrors inside the safe area and above the inset controls', () => {
    for (const [w, h] of [
      [1280, 720],
      [1024, 600],
      [768, 700],
      [768, 1024],
      [800, 820],
    ] as const) {
      const { cockpit, mirrorLeft, mirrorRight } = computeViewports(w, h, 'drive', null, insets);
      if (cockpit === null || mirrorLeft === null || mirrorRight === null) {
        throw new Error('drive mode has mirrors');
      }
      const at = `${w}x${h}`;
      expect(mirrorLeft.x, at).toBeGreaterThanOrEqual(insets.left);
      for (const m of [mirrorLeft, mirrorRight]) {
        expect(m.y, at).toBeGreaterThanOrEqual(cockpit.y + (cockpit.y === 0 ? insets.top : 0));
        expect(m.y + m.height, at).toBeLessThanOrEqual(h - controlsHeight(w, h, insets));
      }
      // Only a cockpit that reaches the screen's right edge has the inset there.
      if (cockpit.x + cockpit.width >= w) {
        expect(mirrorRight.x + mirrorRight.width, at).toBeLessThanOrEqual(w - insets.right);
      }
    }
  });

  it('match the plain layout when there are none', () => {
    const none = { top: 0, right: 0, bottom: 0, left: 0 };
    expect(computeViewports(1280, 720, 'drive', null, none)).toEqual(
      computeViewports(1280, 720, 'drive'),
    );
  });
});

describe('top-down split', () => {
  const sizes: (readonly [number, number])[] = [];
  for (let w = 320; w <= 2000; w += 80) for (let h = 320; h <= 2000; h += 80) sizes.push([w, h]);
  sizes.push([844, 390]);
  const insets = { top: 24, right: 48, bottom: 20, left: 48 };
  const legend = { right: 700, height: 200 };
  /** Stands in for the measured panels: the bottom edge steps down as the pane narrows, and the safe area pushes it further. */
  const STEPS = [
    { from: 296, bottom: 545 },
    { from: 320, bottom: 515 },
    { from: 360, bottom: 485 },
    { from: 400, bottom: 380 },
    { from: 440, bottom: 305 },
  ];
  const stack =
    (inset: Insets | undefined): PanelStack =>
    (paneWidth) => {
      let bottom = 600;
      for (const step of STEPS) if (paneWidth >= step.from) bottom = step.bottom;
      return bottom + (inset?.top ?? 0);
    };
  const edges = [
    { landscape: 0, portrait: 0 },
    { landscape: 1, portrait: 1 },
  ];

  it('keeps the default layout where it was before the split could change', () => {
    for (const [w, h] of sizes) {
      const { topDown, cockpit } = computeViewports(w, h, 'drive');
      if (w >= h) {
        expect(topDown.width, `${w}x${h}`).toBe(Math.round(0.4 * w));
      } else {
        expect(cockpit?.height, `${w}x${h}`).toBe(Math.round(0.55 * h));
      }
      expect(computeViewports(w, h, 'drive', null, undefined, DEFAULT_TOP_DOWN_LAYOUT)).toEqual(
        computeViewports(w, h, 'drive'),
      );
    }
  });

  it('always allows the default and orders min, default and max', () => {
    for (const [w, h] of sizes) {
      for (const inset of [undefined, insets]) {
        const split = topDownSplit(w, h, undefined, legend, inset, stack(inset));
        const { min, max, fallback } = split;
        expect(min, `${w}x${h}`).toBeLessThanOrEqual(fallback);
        expect(fallback, `${w}x${h}`).toBeLessThanOrEqual(max);
        expect(split.share).toBe(fallback);
      }
    }
  });

  it('clamps the share to the screen range', () => {
    const [lo, hi] = edges.map((layout) =>
      topDownSplit(1280, 720, layout, null, insets, stack(insets)),
    );
    expect(lo?.share).toBe(lo?.min);
    expect(hi?.share).toBe(hi?.max);
    // The insets crowd the panels, so the pane may not shrink as far as without them.
    expect(lo?.min).toBeCloseTo(360 / 1280);
    expect(topDownSplit(1280, 720, edges[0], null, NO_INSETS, stack(NO_INSETS)).min).toBeCloseTo(
      0.25,
    );
    expect(hi?.max).toBeLessThan(0.6);
    // Portrait: the pane's height holds the panels and the divider row.
    expect(topDownSplit(1000, 1024, edges[0], null, insets, stack(insets)).min).toBeCloseTo(
      (305 + insets.top + 44 + 8) / 1024,
    );
  });

  it('has no room for the divider where no panel row fits above it', () => {
    for (const layout of edges) {
      const split = topDownSplit(844, 390, layout, null, NO_INSETS, stack(NO_INSETS));
      expect(split).toMatchObject({ min: 0.4, max: 0.4, share: 0.4 });
    }
    // Measured per width: the same screen with a roomier stack has a range again.
    const roomy = topDownSplit(844, 390, edges[1], null, NO_INSETS, () => 100);
    expect(roomy.min).toBeCloseTo(0.25);
    expect(roomy.max).toBeGreaterThan(roomy.min);
  });

  it('finds the narrowest pane the measured panels allow', () => {
    // Fits from a 300 px pane on: the search lands on that width, not the range's edge.
    const { min } = topDownSplit(1000, 800, edges[0], null, NO_INSETS, (w) =>
      w >= 300 ? 100 : 5000,
    );
    expect(min * 1000).toBeGreaterThanOrEqual(300);
    expect(min * 1000).toBeLessThan(301.5);
  });

  it('tiles the screen and keeps the mirrors clear of the controls at both ends of the range', () => {
    for (const layout of edges) {
      for (const [w, h] of sizes) {
        for (const inset of [undefined, insets]) {
          const at = `${w}x${h} ${JSON.stringify(layout)} ${inset ? 'inset' : 'plain'}`;
          const { cockpit, topDown, mirrorLeft, mirrorRight } = computeViewports(
            w,
            h,
            'drive',
            legend,
            inset,
            layout,
            stack(inset),
          );
          if (cockpit === null || mirrorLeft === null || mirrorRight === null) {
            throw new Error('drive mode has mirrors');
          }
          if (w >= h) {
            expect(cockpit.width + topDown.width, at).toBe(w);
            expect(cockpit.x + cockpit.width, at).toBe(topDown.x);
          } else {
            expect(cockpit.height + topDown.height, at).toBe(h);
            expect(cockpit.y, at).toBe(topDown.height);
          }
          for (const m of [mirrorLeft, mirrorRight]) {
            expect(m.x, at).toBeGreaterThanOrEqual(cockpit.x);
            expect(m.x + m.width, at).toBeLessThanOrEqual(cockpit.x + cockpit.width);
            expect(m.y, at).toBeGreaterThanOrEqual(cockpit.y);
            // The default layout may itself leave no room; only a range this module widened must clear.
            const { share, fallback } = topDownSplit(w, h, layout, legend, inset, stack(inset));
            if (share !== fallback && m.height !== MIN_MIRROR_HEIGHT) {
              expect(m.y + m.height, at).toBeLessThanOrEqual(h - controlsHeight(w, h, inset));
            }
            if (share !== fallback && h >= w) {
              expect(m.y + m.height, at).toBeLessThanOrEqual(h - legend.height);
            }
          }
        }
      }
    }
  });

  it('leaves a landscape cockpit wide enough for the wheel, gears and legend', () => {
    for (const [w, h] of sizes.filter(([a, b]) => a >= b)) {
      const { share, fallback } = topDownSplit(w, h, edges[1], null, insets, stack(insets));
      if (share === fallback) continue;
      const { cockpit } = computeViewports(w, h, 'drive', null, insets, edges[1], stack(insets));
      const needed = insets.left + 3 * 16 + 92.4 + 176 + wheelSize(w, h, insets);
      expect(cockpit?.width, `${w}x${h}`).toBeGreaterThanOrEqual(needed - 1);
    }
  });

  it('is the whole screen in replay whatever the layout', () => {
    expect(computeViewports(1280, 720, 'replay', null, undefined, edges[1]).topDown).toEqual({
      x: 0,
      y: 0,
      width: 1280,
      height: 720,
    });
  });
});

/** Word widths in px at 14 px Geist medium, measured in the page (the toast's box, padding excluded). */
const MESSAGE_WORD_PX: Readonly<Record<string, number>> = {
  Anhänger: 65,
  Anschlag: 63,
  Außerhalb: 70,
  Berührung: 71,
  'Berührung:': 75,
  Contact: 53,
  'Contact:': 57,
  Coupling: 60,
  D: 10,
  Deichsel: 58,
  Drehschemelwinkel: 131,
  Gegenrichtung: 99,
  In: 12,
  Kupplungswinkel: 116,
  Limit: 32,
  Lkw: 27,
  Outside: 54,
  R: 10,
  Select: 43,
  Toleranz: 56,
  Turntable: 62,
  ahead: 41,
  am: 20,
  and: 25,
  angle: 37,
  anhalten: 57,
  at: 13,
  ausweichen: 80,
  away: 36,
  countersteer: 86,
  der: 23,
  drawbar: 57,
  drive: 35,
  fahren: 43,
  gegenlenken: 86,
  in: 12,
  jetzt: 32,
  limit: 29,
  now: 28,
  oder: 31,
  or: 14,
  other: 36,
  steer: 36,
  stop: 31,
  the: 22,
  to: 14,
  tolerance: 63,
  trailer: 41,
  truck: 37,
  um: 20,
  und: 25,
  voraus: 45,
  way: 28,
  'wählen,': 51,
  zu: 16,
  '–': 8,
};
const MEASURED_SPACE_PX = 3;

/** Greedy word wrap with the measured widths: what the browser does, give or take kerning. */
function referenceLines(text: string, width: number): number {
  let lines = 1;
  let used = 0;
  for (const word of text.split(/\s+/)) {
    const px = MESSAGE_WORD_PX[word] ?? Infinity;
    if (used === 0) used = px;
    else if (used + MEASURED_SPACE_PX + px <= width) used += MEASURED_SPACE_PX + px;
    else {
      lines++;
      used = px;
    }
  }
  return lines;
}

describe('computeViewports front mirror', () => {
  const FRONT = { front: true, wide: false };
  const apart = (a: Rect, b: Rect): boolean =>
    a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
  const sizes: (readonly [number, number])[] = [
    [390, 844],
    [360, 800],
    [844, 390],
    [1280, 800],
  ];
  for (let w = 320; w <= 2000; w += 40) {
    for (let h = 320; h <= 2000; h += 40) sizes.push([w, h]);
  }

  it('is only there when asked for, and moves nothing else', () => {
    for (const [w, h] of sizes) {
      const plain = computeViewports(w, h, 'drive');
      const extra = computeViewports(w, h, 'drive', null, undefined, undefined, null, FRONT);
      expect(plain.front, `${w}x${h}`).toBeNull();
      expect({ ...extra, front: null }, `${w}x${h}`).toEqual(plain);
    }
  });

  it('keeps the top-down rect and the split the same with it on or off', () => {
    for (const [w, h] of sizes) {
      for (const legend of [null, { right: 300, height: 260 }]) {
        const plain = computeViewports(w, h, 'drive', legend);
        const extra = computeViewports(w, h, 'drive', legend, undefined, undefined, null, FRONT);
        expect(extra.topDown, `${w}x${h}`).toEqual(plain.topDown);
        expect(extra.cockpit, `${w}x${h}`).toEqual(plain.cockpit);
        expect(extra.mirrorLeft, `${w}x${h}`).toEqual(plain.mirrorLeft);
        expect(extra.mirrorRight, `${w}x${h}`).toEqual(plain.mirrorRight);
      }
    }
  });

  it('is shown at the required landscape sizes', () => {
    for (const [w, h] of [
      [1350, 600],
      [1280, 800],
      [1280, 720],
      [1920, 1080],
      [768, 1024],
      [1210, 720],
    ] as const) {
      const { front } = computeViewports(w, h, 'drive', null, undefined, undefined, null, FRONT);
      expect(front, `${w}x${h}`).not.toBeNull();
    }
  });

  it('is replaced by nothing in replay', () => {
    expect(
      computeViewports(800, 600, 'replay', null, undefined, undefined, null, FRONT).front,
    ).toBeNull();
  });

  it('lies in the windscreen band, clear of the mirrors, the controls and the legend, at every size', () => {
    let shown = 0;
    for (const [w, h] of sizes) {
      for (const legend of [null, { right: 300, height: 260 }, { right: w - 40, height: 260 }]) {
        const views = computeViewports(w, h, 'drive', legend, undefined, undefined, null, FRONT);
        const { cockpit, mirrorLeft, mirrorRight, front } = views;
        if (front === null) continue;
        shown++;
        if (cockpit === null || mirrorLeft === null || mirrorRight === null) {
          throw new Error('drive mode has mirrors');
        }
        const at = `${w}x${h} ${JSON.stringify(legend)}`;
        expect(front.width, at).toBeGreaterThanOrEqual(MIN_FRONT_WIDTH);
        expect(front.width, at).toBe(FRONT_ASPECT * front.height);
        expect(front.x, at).toBeGreaterThanOrEqual(cockpit.x);
        expect(front.x + front.width, at).toBeLessThanOrEqual(cockpit.x + cockpit.width);
        expect(front.y, at).toBeGreaterThanOrEqual(cockpit.y);
        expect(front.y + front.height, at).toBeLessThanOrEqual(h - controlsHeight(w, h));
        expect(apart(front, mirrorLeft), at).toBe(true);
        expect(apart(front, mirrorRight), at).toBe(true);
        expect(mirrorRight.x - (front.x + front.width), `${at} gap`).toBeGreaterThanOrEqual(
          FRONT_GAP_PX,
        );
        if (legend !== null && legend.right > front.x) {
          expect(front.y + front.height, at).toBeLessThanOrEqual(h - legend.height);
        }
        // in the cockpit camera's NDC: right of the visor, above the sight cone's top
        const ndcX = (x: number): number => (2 * (x - cockpit.x)) / cockpit.width - 1;
        const ndcY = (y: number): number => 1 - (2 * (y - cockpit.y)) / cockpit.height;
        expect(ndcX(front.x), at).toBeGreaterThanOrEqual(VISOR.right);
        expect(ndcY(front.y + front.height), at).toBeGreaterThanOrEqual(
          coneTop(COCKPIT_FOV) + CONE_GAP - 1e-6,
        );
        const band = frontBand(cockpit.width / cockpit.height, ndcX(mirrorRight.x), cockpit.width);
        if (band === null) throw new Error(`${at}: a rect without a band`);
        expect(ndcX(front.x + front.width), at).toBeLessThanOrEqual(band.right + 1e-6);
        expect(ndcY(front.y), at).toBeLessThanOrEqual(band.top + 1e-6);
      }
    }
    expect(shown).toBeGreaterThan(100);
  });

  it('starts below the display cut-out where the band would reach into it', () => {
    // each inset lies below the band's top at its size, so only the clamp keeps the rect out of it
    for (const [w, h, top] of [
      [1920, 1080, 150],
      [2560, 1440, 200],
    ] as const) {
      const insets = { top, right: 0, bottom: 0, left: 0 };
      const plain = computeViewports(w, h, 'drive', null, NO_INSETS, undefined, null, FRONT);
      expect(plain.front?.y, `${w}x${h}`).toBeLessThan(top);
      const { front } = computeViewports(w, h, 'drive', null, insets, undefined, null, FRONT);
      expect(front, `${w}x${h}`).not.toBeNull();
      expect(front?.y, `${w}x${h}`).toBe(top);
    }
  });

  it('keeps the toast column between the left mirror and the front mirror, wide enough for its words', () => {
    const insets = { top: 0, right: 0, bottom: 0, left: 48 };
    let shown = 0;
    let dropped = 0;
    for (const inset of [NO_INSETS, insets]) {
      for (const [w, h] of sizes) {
        const views = computeViewports(w, h, 'drive', null, inset, undefined, null, FRONT);
        const { front, mirrorLeft } = views;
        if (front === null || mirrorLeft === null) {
          dropped++;
          continue;
        }
        shown++;
        const column = messageColumn(views);
        const at = `${w}x${h} left inset ${inset.left}`;
        expect(column.x, at).toBeGreaterThanOrEqual(mirrorLeft.x + mirrorLeft.width);
        expect(column.x + column.width, at).toBeLessThanOrEqual(front.x);
        // the wrap pads its left by the inset
        expect(column.width - inset.left, at).toBeGreaterThanOrEqual(MIN_MESSAGE_WIDTH);
      }
    }
    expect(shown).toBeGreaterThan(100);
    expect(dropped).toBeGreaterThan(0);
  });

  it('wraps no fewer lines than the measured words do, at every column width', () => {
    for (const keys of [MESSAGE_KEYS.toast, MESSAGE_KEYS.cue]) {
      for (const key of keys) {
        for (const text of [en[key], de[key]]) {
          for (let width = 100; width <= 600; width++) {
            expect(wrapLines(text, width), `${key} ${text} at ${width}`).toBeGreaterThanOrEqual(
              referenceLines(text, width),
            );
          }
        }
      }
    }
  });

  it('knows every word of the messages, and measured none wider than it assumes', () => {
    const texts = [...MESSAGE_KEYS.toast, ...MESSAGE_KEYS.cue].flatMap((key) => [en[key], de[key]]);
    for (const word of texts.flatMap((text) => text.split(/\s+/))) {
      expect(
        MESSAGE_WORD_PX[word],
        `${word} is unmeasured: add it to MESSAGE_WORD_PX`,
      ).toBeDefined();
      expect(wordPx(word), word).toBeGreaterThanOrEqual(MESSAGE_WORD_PX[word] ?? Infinity);
    }
    expect(SPACE_PX).toBeGreaterThanOrEqual(MEASURED_SPACE_PX);
    // MIN_MESSAGE_WIDTH is built on the widest word
    expect(Math.max(...Object.values(MESSAGE_WORD_PX))).toBe(MESSAGE_WORD_PX['Drehschemelwinkel']);
  });

  it('lists exactly the toast and goal-cue messages', () => {
    const keysOf = (pattern: RegExp): string[] =>
      Object.keys(en)
        .filter((key) => pattern.test(key))
        .sort();
    expect([...MESSAGE_KEYS.toast].sort()).toEqual(keysOf(/^(blocked|contactAhead|limitAhead|selectGear)/));
    expect([...MESSAGE_KEYS.cue].sort()).toEqual(keysOf(/^goal(Inside|Outside)$/));
  });

  it('puts the toast column between the class II mirrors without a front mirror, or else in the top-down pane', () => {
    const count = { between: 0, pane: 0 };
    for (const insets of [NO_INSETS, { top: 24, right: 0, bottom: 0, left: 48 }]) {
      for (const [w, h] of sizes) {
        const views = computeViewports(w, h, 'drive', null, insets);
        const { cockpit, mirrorLeft, mirrorRight, topDown } = views;
        if (cockpit === null || mirrorLeft === null || mirrorRight === null) {
          throw new Error('drive mode has mirrors');
        }
        const column = messageColumn(views, insets);
        const at = `${w}x${h} left inset ${insets.left}`;
        if (column.y === cockpit.y) {
          count.between++;
          expect(column.x, at).toBeGreaterThanOrEqual(mirrorLeft.x + mirrorLeft.width);
          expect(column.x + column.width, at).toBeLessThanOrEqual(mirrorRight.x);
          expect(column.width - insets.left, at).toBeGreaterThanOrEqual(MIN_MESSAGE_WIDTH);
        } else {
          count.pane++;
          expect(column.x, at).toBe(topDown.x);
          expect(column.x + column.width, at).toBeLessThanOrEqual(topDown.x + topDown.width);
          if (w < h) expect(column.width, at).toBe(topDown.width);
          // below the finish button, which the pane's first row holds
          expect(column.y, at).toBeGreaterThanOrEqual(topDown.y + 44);
          expect(column.y + column.height, at).toBe(topDown.y + topDown.height);
        }
      }
    }
    expect(count.between).toBeGreaterThan(100);
    expect(count.pane).toBeGreaterThan(100);
  });

  it('puts the toast column in the whole top-down pane in replay', () => {
    const views = computeViewports(800, 600, 'replay');
    expect(messageColumn(views)).toEqual(views.topDown);
  });
});

describe('computeViewports class IV mirrors', () => {
  const WIDE = { front: true, wide: true };
  const PLAIN = { front: true, wide: false };
  const apart = (a: Rect, b: Rect): boolean =>
    a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
  const sizes: (readonly [number, number])[] = [
    [390, 844],
    [360, 800],
    [844, 390],
    [1280, 800],
    [1280, 720],
    [1920, 1080],
  ];
  for (let w = 320; w <= 2000; w += 40) {
    for (let h = 320; h <= 2000; h += 40) sizes.push([w, h]);
  }
  const legends = (w: number) => [
    null,
    { right: 300, height: 260 },
    { right: w - 40, height: 260 },
  ];
  const views = (
    w: number,
    h: number,
    extra: typeof WIDE,
    legend: ReturnType<typeof legends>[number],
    insets?: Insets,
  ) => computeViewports(w, h, 'drive', legend, insets, undefined, null, extra);

  it('is only there when asked for, and replay has none', () => {
    for (const [w, h] of sizes) {
      const plain = views(w, h, PLAIN, null);
      expect(plain.wideLeft, `${w}x${h}`).toBeNull();
      expect(plain.wideRight, `${w}x${h}`).toBeNull();
    }
    const replay = computeViewports(800, 600, 'replay', null, undefined, undefined, null, WIDE);
    expect([replay.wideLeft, replay.wideRight]).toEqual([null, null]);
  });

  it('keeps the top-down rect and the cockpit the same with it on or off', () => {
    for (const [w, h] of sizes) {
      for (const legend of legends(w)) {
        const on = views(w, h, WIDE, legend);
        const off = views(w, h, PLAIN, legend);
        expect(on.topDown, `${w}x${h}`).toEqual(off.topDown);
        expect(on.cockpit, `${w}x${h}`).toEqual(off.cockpit);
      }
    }
  });

  it('hangs under each class II mirror, on its x and width, clear of everything, at every size', () => {
    let shown = 0;
    for (const [w, h] of sizes) {
      for (const legend of legends(w)) {
        const v = views(w, h, WIDE, legend);
        const { cockpit, mirrorLeft, mirrorRight, wideLeft, wideRight, front } = v;
        if (cockpit === null || mirrorLeft === null || mirrorRight === null) {
          throw new Error('drive mode has mirrors');
        }
        const at = `${w}x${h} ${JSON.stringify(legend)}`;
        // both sides or neither
        expect(wideLeft === null, at).toBe(wideRight === null);
        if (wideLeft === null || wideRight === null) continue;
        shown++;
        for (const [wide, above] of [
          [wideLeft, mirrorLeft],
          [wideRight, mirrorRight],
        ] as const) {
          expect(wide.x, at).toBe(above.x);
          expect(wide.width, at).toBe(above.width);
          expect(wide.height, at).toBe(wideHeight(wide.width));
          expect(Math.abs(wide.width / wide.height - WIDE_ASPECT), at).toBeLessThan(0.05);
          expect(wide.width, at).toBeGreaterThanOrEqual(MIN_WIDE_WIDTH);
          expect(wide.height, at).toBeGreaterThanOrEqual(MIN_WIDE_HEIGHT);
          expect(wide.y - (above.y + above.height), `${at} gap`).toBe(WIDE_GAP_PX);
          expect(wide.x, at).toBeGreaterThanOrEqual(cockpit.x);
          expect(wide.x + wide.width, at).toBeLessThanOrEqual(cockpit.x + cockpit.width);
          expect(wide.y + wide.height, at).toBeLessThanOrEqual(h - controlsHeight(w, h));
          // the legend starts right of the left mirror, so only the right one can sit over it
          if (wide === wideRight && legend !== null && legend.right > wide.x) {
            expect(wide.y + wide.height, at).toBeLessThanOrEqual(h - legend.height);
          }
          if (front !== null) expect(apart(wide, front), at).toBe(true);
          if (front !== null) expect(apart(wide, messageColumn(v)), at).toBe(true);
        }
        expect(mirrorLeft.width, at).toBe(mirrorRight.width);
        expect(mirrorLeft.height, at).toBe(mirrorRight.height);
        expect(wideLeft.y, at).toBe(wideRight.y);
        expect(wideLeft.height, at).toBe(wideRight.height);
      }
    }
    expect(shown).toBeGreaterThan(100);
  });

  it('keeps class II its size where the column has room, shrinks both where not, and drops class IV where even that fails', () => {
    const count = { kept: 0, shrunk: 0, dropped: 0 };
    for (const [w, h] of sizes) {
      for (const legend of legends(w)) {
        const on = views(w, h, WIDE, legend);
        const off = views(w, h, PLAIN, legend);
        const at = `${w}x${h} ${JSON.stringify(legend)}`;
        const [a, b] = [on.mirrorLeft, off.mirrorLeft];
        if (a === null || b === null) throw new Error('drive mode has mirrors');
        if (on.wideLeft === null) {
          count.dropped++;
          // nothing moves for the mirror that is not drawn
          expect(on.mirrorLeft, at).toEqual(off.mirrorLeft);
          expect(on.mirrorRight, at).toEqual(off.mirrorRight);
        } else if (a.width === b.width && a.height === b.height) {
          count.kept++;
          expect(a.x, at).toBe(b.x);
        } else {
          count.shrunk++;
          expect(a.width, at).toBeGreaterThanOrEqual(Math.ceil(MIN_CLASS_II_SHARE * b.width));
          expect(a.height, at).toBeGreaterThanOrEqual(Math.ceil(MIN_CLASS_II_SHARE * b.height));
          expect(a.height, at).toBeLessThan(b.height);
          expect(a.x, at).toBe(b.x);
        }
      }
    }
    expect(count.kept).toBeGreaterThan(100);
    expect(count.shrunk).toBeGreaterThan(10);
    expect(count.dropped).toBeGreaterThan(100);
  });

  it('keeps class II below the toast row where the messages span the cockpit, at every size', () => {
    let checked = 0;
    for (const [w, h] of sizes) {
      for (const legend of legends(w)) {
        for (const inset of [NO_INSETS, { top: 24, right: 0, bottom: 0, left: 48 }]) {
          const v = views(w, h, WIDE, legend, inset);
          const { cockpit, mirrorLeft, mirrorRight, wideLeft } = v;
          if (cockpit === null || mirrorLeft === null || mirrorRight === null) {
            throw new Error('drive mode has mirrors');
          }
          if (wideLeft === null || v.front !== null) continue;
          checked++;
          // the longest toast in the full-width column, wrapped with the measured words
          const room = cockpit.width - inset.left - 32 - 41;
          const lines = Math.max(
            ...MESSAGE_KEYS.toast
              .flatMap((key) => [en[key], de[key]])
              .map((t) => referenceLines(t, room)),
          );
          const toastBottom = cockpit.y + 16 + (w >= h ? inset.top : 0) + lines * 22 + 18;
          const at = `${w}x${h} ${JSON.stringify(legend)} left inset ${inset.left}`;
          expect(mirrorLeft.y, at).toBeGreaterThanOrEqual(toastBottom);
          expect(mirrorRight.y, at).toBeGreaterThanOrEqual(toastBottom);
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('is shown at the required landscape sizes', () => {
    for (const [w, h] of [
      [1280, 800],
      [1280, 720],
      [1920, 1080],
      [1366, 768],
    ] as const) {
      const v = views(w, h, WIDE, null);
      expect(v.wideLeft, `${w}x${h}`).not.toBeNull();
      expect(v.front, `${w}x${h}`).not.toBeNull();
    }
  });

  it('is shown at laptop viewports, where the cockpit column is the limit', () => {
    for (const [w, h] of [
      [1536, 729],
      [1536, 701],
      [1440, 719],
      [1470, 762],
      [1512, 788],
    ] as const) {
      const v = views(w, h, WIDE, null);
      expect(v.wideLeft, `${w}x${h}`).not.toBeNull();
      expect(v.wideRight, `${w}x${h}`).not.toBeNull();
    }
  });

  it('puts class II beside a legend that reaches under it when that holds class IV below the legend top', () => {
    const [w, h] = [1440, 765];
    const legend = { right: 721.09, height: 409.7 };
    const v = views(w, h, WIDE, legend);
    if (v.wideRight === null) throw new Error('class IV beside the legend');
    expect(v.wideRight.y + v.wideRight.height).toBeGreaterThan(h - legend.height);
  });
});
