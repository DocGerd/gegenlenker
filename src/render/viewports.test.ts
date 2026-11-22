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
  MIN_FRONT_WIDTH,
  MIN_MESSAGE_WIDTH,
  MIN_MIRROR_HEIGHT,
  NO_INSETS,
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

describe('computeViewports front mirror', () => {
  const FRONT = { front: true };
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
      [1280, 720, 120],
      [1920, 1080, 200],
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

  it('pins the widest word of a toast or goal cue that MIN_MESSAGE_WIDTH is measured for', () => {
    const messages = [en, de].flatMap((table) =>
      Object.entries(table)
        .filter(([key]) => /^(blocked|goal|contactAhead|selectGear)/.test(key))
        .map(([, text]) => text),
    );
    const longest = messages
      .flatMap((text) => text.split(/\s+/))
      .sort((a, b) => b.length - a.length)[0];
    // 131 px at 14 px Geist; a longer word needs a new measurement and a wider MIN_MESSAGE_WIDTH
    expect(longest).toBe('Drehschemelwinkel');
  });

  it('leaves the toast column alone without a front mirror', () => {
    const views = computeViewports(1280, 720, 'drive');
    expect(messageColumn(views)).toEqual(views.cockpit);
  });
});
