import { describe, expect, it } from 'vitest';
import { DEFAULT_TOP_DOWN_LAYOUT } from '../contracts/render';
import {
  computeViewports,
  controlsHeight,
  MIN_MIRROR_HEIGHT,
  NO_INSETS,
  topDownSplit,
  wheelSize,
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
  const insets = { top: 24, right: 48, bottom: 20, left: 48 };
  const legend = { right: 700, height: 200 };
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
        const { min, max, fallback } = topDownSplit(w, h, undefined, legend, inset);
        expect(min, `${w}x${h}`).toBeLessThanOrEqual(fallback);
        expect(fallback, `${w}x${h}`).toBeLessThanOrEqual(max);
        expect(topDownSplit(w, h, undefined, legend, inset).share).toBe(fallback);
      }
    }
  });

  it('clamps the share to the screen range', () => {
    const [lo, hi] = edges.map((layout) => topDownSplit(1280, 720, layout, null, insets));
    expect(lo?.share).toBe(lo?.min);
    expect(hi?.share).toBe(hi?.max);
    // The insets crowd the panels, so the pane may not shrink as far as without them.
    expect(lo?.min).toBeCloseTo(360 / 1280);
    expect(topDownSplit(1280, 720, edges[0], null, NO_INSETS).min).toBeCloseTo(0.25);
    expect(hi?.max).toBeLessThan(0.6);
    expect(topDownSplit(1000, 1024, edges[0], null, insets).min).toBeCloseTo(0.3125);
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
            const { share, fallback } = topDownSplit(w, h, layout, legend, inset);
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
      const { share, fallback } = topDownSplit(w, h, edges[1], null, insets);
      if (share === fallback) continue;
      const { cockpit } = computeViewports(w, h, 'drive', null, insets, edges[1]);
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
