import { describe, expect, it } from 'vitest';
import { DEFAULT_TOP_DOWN_LAYOUT, type LegendBox, type Rect } from '../contracts/render';
import { de } from '../i18n/de';
import { en } from '../i18n/en';
import { CLOSE_ASPECT, MIN_CLOSE_WIDTH } from './close-mirror';
import {
  CLEAR_CONE_DEG,
  COCKPIT_FOV,
  coneTop,
  CONE_GAP,
  FRONT_GAP_PX,
  frontBand,
  VISOR,
} from './cockpit-band';
import {
  computeViewports,
  controlsHeight,
  FRONT_ASPECT,
  hasTopDown,
  messageColumn,
  MESSAGE_KEYS,
  MIN_FRONT_WIDTH,
  MIN_MESSAGE_WIDTH,
  SPACE_PX,
  SOFT_HYPHEN,
  wordPx,
  wrapLines,
  MIN_CLASS_II_SHARE,
  MIN_MIRROR_HEIGHT,
  MIN_SQUEEZED_HEIGHT,
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
import { declared, padding, px, SOURCE } from './viewports-css';

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
          // With no room even for the squeezed minimum, the mirror keeps that size instead.
          if (m.height > MIN_SQUEEZED_HEIGHT) {
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
          if (m.x < legend.right && m.height > MIN_SQUEEZED_HEIGHT) {
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

  it('shrink class II below the minimum height rather than reach into the inset controls', () => {
    const [w, h] = [800, 801];
    const { mirrorLeft, mirrorRight } = computeViewports(w, h, 'drive', null, insets);
    for (const m of [mirrorLeft, mirrorRight]) {
      if (m === null) throw new Error('drive mode has mirrors');
      expect(m.height).toBeLessThan(MIN_MIRROR_HEIGHT);
      expect(m.height).toBeGreaterThanOrEqual(MIN_SQUEEZED_HEIGHT);
      expect(m.y + m.height).toBeLessThanOrEqual(h - controlsHeight(w, h, insets));
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
    // the message column beside the stop button and lever sets the floor
    expect(roomy.min).toBeCloseTo(Math.ceil(MIN_MESSAGE_WIDTH + 1.5 * 44 + 16 + 8) / 844);
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

  it('keeps the landscape pane wide enough for the message column at its narrowest', () => {
    let inPane = 0;
    for (let w = 900; w <= 1400; w += 10) {
      for (let h = 426; h <= w; h += 10) {
        for (const inset of [NO_INSETS, insets]) {
          const views = computeViewports(w, h, 'drive', null, inset, edges[0]);
          const column = messageColumn(views, null, inset);
          if (column.y === views.cockpit?.y) continue;
          inPane++;
          expect(column.width, `${w}x${h} left inset ${inset.left}`).toBeGreaterThanOrEqual(
            MIN_MESSAGE_WIDTH,
          );
        }
      }
    }
    expect(inPane).toBeGreaterThan(0);
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
            if (share !== fallback) {
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

  it('leaves the cockpit the room its controls need', () => {
    for (const [w, h] of sizes) {
      const { share, fallback } = topDownSplit(w, h, edges[1], legend, insets, stack(insets));
      if (share === fallback) continue;
      const { cockpit } = computeViewports(w, h, 'drive', legend, insets, edges[1], stack(insets));
      const landscape = w >= h;
      const needed = landscape
        ? insets.left + 3 * 16 + 92.4 + 176 + wheelSize(w, h, insets)
        : 32 + MIN_MIRROR_HEIGHT + 8 + Math.max(controlsHeight(w, h, insets), legend.height);
      expect(landscape ? cockpit?.width : cockpit?.height, `${w}x${h}`).toBeGreaterThanOrEqual(
        needed,
      );
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

/**
 * Word widths in px at 14 px Geist medium, measured in the page (the toast's box, padding excluded); a
 * word with a soft hyphen also its pieces at a break, the first with the hyphen shown (`min-content`).
 */
const MESSAGE_WORD_PX: Readonly<Record<string, number>> = {
  Anhänger: 65,
  '{dist}': 30, // stands for the widest distance of the goal cue, "88,8"
  Anschlag: 63,
  Berührung: 71,
  'Berührung:': 75,
  Contact: 53,
  'Contact:': 57,
  Coupling: 60,
  D: 10,
  Deichsel: 58,
  'Drehschemel\u00ADwinkel': 131,
  'Drehschemel-': 93,
  Gegenrichtung: 99,
  In: 12,
  'Kupplungs\u00ADwinkel': 116,
  'Kupplungs-': 78,
  Limit: 32,
  Lkw: 27,
  R: 10,
  Select: 43,
  Winkel: 46,
  Position: 54,
  position: 54,
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
  falsch: 42,
  gegenlenken: 86,
  in: 12,
  jetzt: 32,
  limit: 29,
  m: 12,
  now: 28,
  off: 18,
  ok: 17,
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
  winkel: 44,
  'wählen,': 51,
  zu: 16,
  '–': 8,
  '·': 3,
};
const MEASURED_SPACE_PX = 3;

/** A word's breaks at its soft hyphens: the piece before, hyphen shown, and the rest. */
const softBreaks = (word: string): [string, string][] => {
  const pieces = word.split(SOFT_HYPHEN);
  return pieces
    .slice(1)
    .map((_, i) => [`${pieces.slice(0, i + 1).join('')}-`, pieces.slice(i + 1).join(SOFT_HYPHEN)]);
};

/**
 * Greedy wrap with the measured widths at spaces and soft hyphens, the last break that fits taken:
 * what the browser does, give or take kerning.
 */
function referenceLines(text: string, width: number): number {
  const px = (word: string): number => MESSAGE_WORD_PX[word] ?? Infinity;
  let lines = 1;
  let used = 0;
  for (const word of text.split(/\s+/)) {
    let rest = word;
    for (;;) {
      const at = used === 0 ? 0 : used + MEASURED_SPACE_PX;
      if (at + px(rest) <= width) {
        used = at + px(rest);
        break;
      }
      const cut = softBreaks(rest).findLast(([head]) => at + px(head) <= width);
      if (cut !== undefined) {
        lines++;
        used = 0;
        rest = cut[1];
      } else if (used > 0) {
        lines++;
        used = 0;
      } else {
        const first = softBreaks(rest)[0];
        if (first === undefined) {
          used = px(rest);
          break;
        }
        lines++;
        rest = first[1];
      }
    }
  }
  return lines;
}

describe('computeViewports front mirror', () => {
  const FRONT = { front: true, wide: false, close: false };
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
        const column = messageColumn(views, null);
        const at = `${w}x${h} left inset ${inset.left}`;
        expect(column.x, at).toBeGreaterThanOrEqual(mirrorLeft.x + mirrorLeft.width);
        expect(column.x + column.width, at).toBeLessThanOrEqual(front.x);
        expect(column.x, at).toBeGreaterThanOrEqual(inset.left);
        expect(column.width, at).toBeGreaterThanOrEqual(MIN_MESSAGE_WIDTH);
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
    const words = texts
      .flatMap((text) => text.split(/\s+/))
      .flatMap((word) => [word, ...softBreaks(word).flat()]);
    for (const word of words) {
      expect(
        MESSAGE_WORD_PX[word],
        `${word} is unmeasured: add it to MESSAGE_WORD_PX`,
      ).toBeDefined();
      expect(wordPx(word), word).toBeGreaterThanOrEqual(MESSAGE_WORD_PX[word] ?? Infinity);
    }
    expect(SPACE_PX).toBeGreaterThanOrEqual(MEASURED_SPACE_PX);
    // MIN_MESSAGE_WIDTH is built on the widest word no soft hyphen breaks
    const unbreakable = words.filter((word) => !word.includes(SOFT_HYPHEN));
    const widest = Math.max(...unbreakable.map((word) => MESSAGE_WORD_PX[word] ?? Infinity));
    expect(widest).toBe(MESSAGE_WORD_PX['Gegenrichtung']);
    expect(MIN_MESSAGE_WIDTH).toBe(widest + 41 + 32);
  });

  it('gives the messages the whole column: the toast wrap has no side padding', () => {
    // `messagesFit` and the layout spec take the column's width as the toasts' room
    const sides = padding(SOURCE.hud, '.hud-toast-wrap');
    expect([px(sides.left), px(sides.right)]).toEqual([0, 0]);
    for (const side of ['padding-left', 'padding-right']) {
      expect(() => declared(SOURCE.hud, '.hud-toast-wrap', side)).toThrow(`no ${side}`);
    }
  });

  it('lists exactly the toast and goal-cue messages', () => {
    const keysOf = (pattern: RegExp): string[] =>
      Object.keys(en)
        .filter((key) => pattern.test(key))
        .sort();
    expect([...MESSAGE_KEYS.toast].sort()).toEqual(
      keysOf(/^(blocked|contactAhead|limitAhead|selectGear)/),
    );
    expect([...MESSAGE_KEYS.cue].sort()).toEqual(keysOf(/^goal(Inside|Distance|Angle|Position)/));
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
        const column = messageColumn(views, null, insets);
        const at = `${w}x${h} left inset ${insets.left}`;
        if (column.y === cockpit.y) {
          count.between++;
          expect(column.x, at).toBeGreaterThanOrEqual(mirrorLeft.x + mirrorLeft.width);
          expect(column.x + column.width, at).toBeLessThanOrEqual(mirrorRight.x);
          expect(column.x, at).toBeGreaterThanOrEqual(insets.left);
          expect(column.width, at).toBeGreaterThanOrEqual(MIN_MESSAGE_WIDTH);
        } else {
          count.pane++;
          const portrait = w < h;
          // in portrait the pane spans the screen, so the column keeps clear of the safe area
          expect(column.x, at).toBe(topDown.x + (portrait ? insets.left : 0));
          expect(column.x + column.width, at).toBeLessThanOrEqual(
            topDown.x + topDown.width - (portrait ? insets.right : 0),
          );
          if (portrait) expect(column.width, at).toBe(topDown.width - insets.left - insets.right);
          // below the finish button, which the pane's first row holds below the cut-out
          expect(column.y, at).toBeGreaterThanOrEqual(topDown.y + 44 + (portrait ? insets.top : 0));
          expect(column.y + column.height, at).toBe(topDown.y + topDown.height);
        }
      }
    }
    expect(count.between).toBeGreaterThan(100);
    expect(count.pane).toBeGreaterThan(100);
  });

  it('moves the toast column into the top-down pane where its stack would cover the open key legend', () => {
    const legend = { right: 755, height: 381 };
    const open = computeViewports(840, 841, 'drive', legend, NO_INSETS);
    const closed = computeViewports(840, 841, 'drive', null, NO_INSETS);
    expect(messageColumn(closed, null, NO_INSETS).y).toBe(closed.cockpit?.y);
    const column = messageColumn(open, legend, NO_INSETS);
    expect(column.x).toBe(open.topDown.x);
    expect(column.y).toBeGreaterThanOrEqual(open.topDown.y + 44);
    expect(column.y + column.height).toBe(open.topDown.y + open.topDown.height);
  });

  it('puts the toast column in the whole top-down pane in replay, clear of the safe area', () => {
    const views = computeViewports(800, 600, 'replay');
    expect(messageColumn(views, null)).toEqual({ ...views.topDown, cueYields: false });
    const insets = { top: 24, right: 48, bottom: 20, left: 48 };
    expect(messageColumn(views, null, insets)).toEqual({
      ...views.topDown,
      x: 48,
      width: 800 - 96,
      cueYields: false,
    });
  });
});

describe('computeViewports class IV mirrors', () => {
  const WIDE = { front: true, wide: true, close: false };
  const PLAIN = { front: true, wide: false, close: false };
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
          if (front !== null) expect(apart(wide, messageColumn(v, null)), at).toBe(true);
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

  it('keeps class II and class IV out of the forward sight cone, with and without side insets', () => {
    const tan = Math.tan((COCKPIT_FOV * Math.PI) / 360);
    const nearest = (lo: number, hi: number): number =>
      lo <= 0 && hi >= 0 ? 0 : Math.min(Math.abs(lo), Math.abs(hi));
    /** Degrees off the cockpit camera's axis of the point of `r` nearest it. */
    const offAxis = (r: Rect, c: Rect): number => {
      const x = nearest((2 * (r.x - c.x)) / c.width - 1, (2 * (r.x + r.width - c.x)) / c.width - 1);
      const y = nearest(
        1 - (2 * (r.y + r.height - c.y)) / c.height,
        1 - (2 * (r.y - c.y)) / c.height,
      );
      return (Math.atan(Math.hypot((x * c.width * tan) / c.height, y * tan)) * 180) / Math.PI;
    };
    const notch = { top: 24, right: 48, bottom: 20, left: 48 };
    // smaller screens (phones, no target) can leave class II in the cone at its least share
    const targets = sizes.filter(([w, h]) => Math.min(w, h) >= 600 && Math.max(w, h) >= 800);
    let wide = 0;
    for (const [w, h] of targets) {
      for (const mode of ['drive', 'mirrors'] as const) {
        for (const insets of [NO_INSETS, notch]) {
          const v = computeViewports(w, h, mode, null, insets, undefined, null, WIDE);
          const { cockpit, mirrorLeft, mirrorRight, wideLeft, wideRight } = v;
          if (cockpit === null) throw new Error('drive and mirror-only have a cockpit');
          if (wideLeft !== null) wide++;
          for (const r of [mirrorLeft, mirrorRight, wideLeft, wideRight]) {
            if (r === null) continue;
            const at = `${w}x${h} ${mode} ${JSON.stringify(insets)} ${JSON.stringify(r)}`;
            expect(offAxis(r, cockpit), at).toBeGreaterThanOrEqual(CLEAR_CONE_DEG);
          }
        }
      }
    }
    expect(wide).toBeGreaterThan(100);
  });

  it('keeps class II at least MIN_CLASS_II_SHARE of its size without class IV and the sight cone', () => {
    const notch = { top: 24, right: 48, bottom: 20, left: 48 };
    // Without side insets the mirrors sit further out, beside the cone; where the cockpit is the same,
    // that class II is no larger than the inset one without the cone (a smaller left inset only grows the wheel).
    const sideless = { ...notch, left: 0, right: 0 };
    let coneShrunk = 0;
    for (const [w, h] of [[800, 730] as const, ...sizes]) {
      for (const mode of ['drive', 'mirrors'] as const) {
        const on = computeViewports(w, h, mode, null, notch, undefined, null, WIDE);
        const off = computeViewports(w, h, mode, null, notch, undefined, null, PLAIN);
        const free = computeViewports(w, h, mode, null, sideless, undefined, null, PLAIN);
        if (JSON.stringify(on.cockpit) !== JSON.stringify(free.cockpit)) continue;
        const [a, b, ref] = [on.mirrorLeft, off.mirrorLeft, free.mirrorLeft];
        if (a === null || b === null || ref === null) throw new Error('drive mode has mirrors');
        if (on.wideLeft === null) continue;
        if (b.width < ref.width) coneShrunk++;
        const at = `${w}x${h} ${mode}`;
        expect(a.width, at).toBeGreaterThanOrEqual(Math.ceil(MIN_CLASS_II_SHARE * ref.width));
        expect(a.height, at).toBeGreaterThanOrEqual(Math.ceil(MIN_CLASS_II_SHARE * ref.height));
      }
    }
    expect(coneShrunk).toBeGreaterThan(0);
  });

  it('moves the stack up out of the sight cone before it shrinks class II', () => {
    const on = views(1168, 1018, WIDE, null);
    const off = views(1168, 1018, PLAIN, null);
    if (on.mirrorLeft === null || off.mirrorLeft === null)
      throw new Error('drive mode has mirrors');
    expect(on.wideLeft).not.toBeNull();
    expect(on.mirrorLeft.width).toBe(off.mirrorLeft.width);
    expect(on.mirrorLeft.y).toBeLessThan(off.mirrorLeft.y);
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

describe('computeViewports class V mirror', () => {
  const ALL = { front: true, wide: true, close: true };
  const NO_CLOSE = { ...ALL, close: false };
  const apart = (a: Rect, b: Rect): boolean =>
    a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
  const sizes: (readonly [number, number])[] = [
    [390, 844],
    [844, 390],
    [1280, 720],
    [1920, 1080],
    [2560, 1440],
  ];
  for (let w = 320; w <= 2000; w += 40) {
    for (let h = 320; h <= 2000; h += 40) sizes.push([w, h]);
  }
  const views = (w: number, h: number, extra: typeof ALL, legend: LegendBox | null = null) =>
    computeViewports(w, h, 'drive', legend, undefined, undefined, null, extra);

  it('is only there when asked for, and replay has none', () => {
    for (const [w, h] of sizes) expect(views(w, h, NO_CLOSE).close, `${w}x${h}`).toBeNull();
    const replay = computeViewports(800, 600, 'replay', null, undefined, undefined, null, ALL);
    expect(replay.close).toBeNull();
  });

  it('sits right-aligned above the right class II mirror, no wider, clear of everything', () => {
    let shown = 0;
    for (const [w, h] of sizes) {
      for (const legend of [null, { right: w - 40, height: 260 }]) {
        const v = views(w, h, ALL, legend);
        const { cockpit, mirrorRight, close, front } = v;
        if (cockpit === null || mirrorRight === null) throw new Error('drive mode has mirrors');
        if (close === null) continue;
        shown++;
        const at = `${w}x${h} ${JSON.stringify(legend)}`;
        expect(close.width, at).toBe(CLOSE_ASPECT * close.height);
        expect(close.width, at).toBeGreaterThanOrEqual(MIN_CLOSE_WIDTH);
        expect(close.width, at).toBeLessThanOrEqual(mirrorRight.width);
        expect(close.x + close.width, at).toBe(mirrorRight.x + mirrorRight.width);
        expect(mirrorRight.y - (close.y + close.height), `${at} gap`).toBe(WIDE_GAP_PX);
        expect(close.y, at).toBeGreaterThanOrEqual(cockpit.y + 32);
        if (front !== null) expect(apart(close, front), at).toBe(true);
        expect(apart(close, messageColumn(v, null)), at).toBe(true);
      }
    }
    expect(shown).toBeGreaterThan(0);
  });

  it('never moves or resizes the other mirrors, the front mirror or the messages', () => {
    for (const [w, h] of sizes) {
      const on = views(w, h, ALL);
      const off = views(w, h, NO_CLOSE);
      expect({ ...on, close: null }, `${w}x${h}`).toEqual(off);
      expect(messageColumn(on, null), `${w}x${h}`).toEqual(messageColumn(off, null));
    }
  });

  it('shrinks to the room above class II and drops below the minimum width', () => {
    const room = (w: number, h: number): number => {
      const { mirrorRight, cockpit } = views(w, h, ALL);
      return (mirrorRight?.y ?? 0) - WIDE_GAP_PX - ((cockpit?.y ?? 0) + 32);
    };
    let dropped = 0;
    let shrunk = 0;
    for (const [w, h] of sizes) {
      const { close, mirrorRight } = views(w, h, ALL);
      if (mirrorRight === null) continue;
      const fits = Math.min(Math.floor(mirrorRight.width / CLOSE_ASPECT), room(w, h));
      if (close === null) {
        dropped++;
        expect(CLOSE_ASPECT * fits, `${w}x${h}`).toBeLessThan(MIN_CLOSE_WIDTH);
      } else {
        expect(close.height, `${w}x${h}`).toBe(fits);
        if (close.width < mirrorRight.width - 1) shrunk++;
      }
    }
    expect(dropped).toBeGreaterThan(0);
    expect(shrunk).toBeGreaterThan(0);
  });

  it('is present at 1920x1080 and absent on a small laptop', () => {
    expect(views(1920, 1080, ALL).close).not.toBeNull();
    expect(views(1280, 720, ALL).close).toBeNull();
    expect(views(1366, 768, ALL).close).toBeNull();
  });
});

describe('computeViewports mirror-only drive', () => {
  const ALL = { front: true, wide: true, close: true };
  const landscape: readonly (readonly [number, number])[] = [
    [1280, 585],
    [1280, 720],
    [1366, 768],
    [1536, 729],
    [1920, 1080],
  ];
  const mirrorsOnly = (w: number, h: number) =>
    computeViewports(w, h, 'mirrors', null, NO_INSETS, undefined, null, ALL);

  it('gives the cockpit the whole window and the top-down view no area', () => {
    for (const [w, h] of [...landscape, [768, 1024] as const]) {
      const views = mirrorsOnly(w, h);
      expect(views.cockpit, `${w}x${h}`).toEqual({ x: 0, y: 0, width: w, height: h });
      expect(hasTopDown(views), `${w}x${h}`).toBe(false);
      expect(hasTopDown(computeViewports(w, h, 'drive', null, NO_INSETS)), `${w}x${h}`).toBe(true);
    }
  });

  it('keeps the mirrors below the pause button and left of the lever column in landscape', () => {
    const target = 44;
    for (const [w, h] of landscape) {
      const { mirrorLeft, mirrorRight } = mirrorsOnly(w, h);
      if (mirrorLeft === null || mirrorRight === null) throw new Error('mirrors');
      for (const m of [mirrorLeft, mirrorRight]) {
        expect(m.y, `${w}x${h}`).toBeGreaterThanOrEqual(16 + target);
      }
      expect(mirrorRight.x + mirrorRight.width, `${w}x${h}`).toBeLessThanOrEqual(
        w - 16 - 1.5 * target,
      );
    }
  });

  it('keeps the toast column between the mirrors, which have no pane to fall back to', () => {
    for (const [w, h] of landscape) {
      const views = mirrorsOnly(w, h);
      const { mirrorLeft, mirrorRight, front } = views;
      if (mirrorLeft === null || mirrorRight === null) throw new Error('mirrors');
      const column = messageColumn(views, null, NO_INSETS);
      expect(column.x, `${w}x${h}`).toBeGreaterThanOrEqual(mirrorLeft.x + mirrorLeft.width);
      expect(column.x + column.width, `${w}x${h}`).toBeLessThanOrEqual((front ?? mirrorRight).x);
      expect(column.cueYields, `${w}x${h}`).toBe(false);
    }
  });

  it('lets the goal cue yield to a toast where no span beside the mirrors holds both', () => {
    const notch = { top: 24, right: 48, bottom: 20, left: 48 };
    const views = computeViewports(950, 426, 'mirrors', null, notch, undefined, null, ALL);
    expect(messageColumn(views, null, notch).cueYields).toBe(true);
    const plain = computeViewports(950, 426, 'mirrors', null, NO_INSETS, undefined, null, ALL);
    expect(messageColumn(plain, null, NO_INSETS).cueYields).toBe(false);
  });
});
