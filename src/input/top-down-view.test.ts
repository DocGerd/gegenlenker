import { describe, expect, it } from 'vitest';
import { CHASE_TILT, DEFAULT_TOP_DOWN_VIEW, type TopDownView } from '../contracts/render';
import {
  ZOOM_LIMITS,
  clampView,
  wrapAngle,
  isDefaultView,
  panBy,
  pinch,
  wheelFactor,
  zoomAt,
  type Point,
  type ViewContext,
} from './top-down-view';

const yard: ViewContext = { mode: 'yard', width: 600, height: 400 };
const follow: ViewContext = { mode: 'follow', width: 600, height: 400 };
const contexts: readonly ViewContext[] = [yard, follow];

/** Pane-normalised world position (units of the base half-height, y up) under a pane pixel. */
function worldUnder(view: TopDownView, ctx: ViewContext, p: Point): Point {
  const half = ctx.height / 2;
  return {
    x: view.panX + (p.x - ctx.width / 2) / half / view.zoom,
    y: view.panY - (p.y - half) / half / view.zoom,
  };
}

const view = (zoom: number, panX = 0, panY = 0): TopDownView => ({ zoom, panX, panY });

function expectPoint(actual: Point, expected: Point): void {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
}

describe('zoomAt', () => {
  it.each(contexts)('keeps the point under the cursor fixed ($mode)', (ctx) => {
    const start = view(2, 0.05, -0.03);
    const cursor = { x: 420, y: 130 };
    const next = zoomAt(start, 1.5, cursor, ctx);
    expect(next.zoom).toBeCloseTo(3, 9);
    expectPoint(worldUnder(next, ctx, cursor), worldUnder(start, ctx, cursor));
  });

  it.each(contexts)('clamps zoom at both limits with the anchor fixed ($mode)', (ctx) => {
    const { min, max } = ZOOM_LIMITS[ctx.mode];
    const cursor = { x: 100, y: 300 };
    const start = view(max / 1.1, 0.01, 0.01);
    const zoomedIn = zoomAt(start, 50, cursor, ctx);
    expect(zoomedIn.zoom).toBe(max);
    expectPoint(worldUnder(zoomedIn, ctx, cursor), worldUnder(start, ctx, cursor));

    const zoomedOut = zoomAt(view(min * 1.1), 0.001, cursor, ctx);
    expect(zoomedOut.zoom).toBe(min);
  });

  it('keeps the yard at pan 0 when zoomed out to 1', () => {
    const next = zoomAt(view(2, 0.3, -0.2), 0.01, { x: 50, y: 50 }, yard);
    expect(isDefaultView(next)).toBe(true);
  });
});

describe('panBy', () => {
  it.each(contexts)('moves the content with the finger ($mode)', (ctx) => {
    const start = view(2);
    const p = { x: 300, y: 200 };
    const dx = 30;
    const dy = -20;
    const before = worldUnder(start, ctx, p);
    const next = panBy(start, dx, dy, ctx);
    expectPoint(worldUnder(next, ctx, { x: p.x + dx, y: p.y + dy }), before);
  });

  it('signs: drag right lowers panX, drag down raises panY', () => {
    const next = panBy(view(2), 10, 10, yard);
    expect(next.panX).toBeLessThan(0);
    expect(next.panY).toBeGreaterThan(0);
  });

  it('cannot move the yard at zoom 1 and stays bounded at zoom 2', () => {
    expect(isDefaultView(panBy(view(1), 500, 500, yard))).toBe(true);
    const far = panBy(view(2), -1e6, 1e6, yard);
    expect(far.panX).toBeCloseTo((yard.width / yard.height) * 0.5, 9);
    expect(far.panY).toBeCloseTo(0.5, 9);
  });

  it('keeps the follow target inside the pane', () => {
    const half = follow.height / 2;
    for (const [dx, dy] of [
      [1e6, -1e6],
      [-1e6, 1e6],
    ] as const) {
      const far = panBy(view(2), dx, dy, follow);
      // The target is the world origin: its pixel follows from the view centre.
      const px = follow.width / 2 - far.panX * far.zoom * half;
      const py = half + far.panY * far.zoom * half;
      expect(px).toBeGreaterThan(0);
      expect(px).toBeLessThan(follow.width);
      expect(py).toBeGreaterThan(0);
      expect(py).toBeLessThan(follow.height);
    }
  });
});

describe('pinch', () => {
  const a0 = { x: 200, y: 200 };
  const b0 = { x: 300, y: 200 };

  it.each(contexts)(
    'keeps the midpoint fixed and scales zoom by the finger distance ($mode)',
    (ctx) => {
      const start = view(1.5, 0.02, 0.01);
      const a1 = { x: 180, y: 150 };
      const b1 = { x: 380, y: 170 };
      const next = pinch(start, [a0, b0], [a1, b1], ctx);
      const mid0 = { x: 250, y: 200 };
      const mid1 = { x: 280, y: 160 };
      expectPoint(worldUnder(next, ctx, mid1), worldUnder(start, ctx, mid0));
      expect(next.zoom).toBeCloseTo(start.zoom * (Math.hypot(200, 20) / 100), 9);
    },
  );

  it('two fingers moving together equal a pan', () => {
    const start = view(3);
    const together = pinch(
      start,
      [a0, b0],
      [
        { x: a0.x + 17, y: a0.y - 9 },
        { x: b0.x + 17, y: b0.y - 9 },
      ],
      yard,
    );
    const panned = panBy(start, 17, -9, yard);
    expect(together.zoom).toBeCloseTo(panned.zoom, 9);
    expect(together.panX).toBeCloseTo(panned.panX, 9);
    expect(together.panY).toBeCloseTo(panned.panY, 9);
  });

  it('does not zoom from coincident fingers', () => {
    const start = view(2);
    const next = pinch(start, [a0, a0], [a0, { x: 400, y: 200 }], yard);
    expect(next.zoom).toBe(2);
  });
});

describe('clampView', () => {
  it('limits zoom per mode', () => {
    expect(clampView(view(100), yard).zoom).toBe(ZOOM_LIMITS.yard.max);
    expect(clampView(view(0.1), follow).zoom).toBe(ZOOM_LIMITS.follow.min);
    expect(clampView(view(0.5), yard).zoom).toBe(ZOOM_LIMITS.yard.min);
  });

  it('re-clamps pan when the pane shrinks', () => {
    const wide = view(2, 0.9, 0.5);
    const narrow = clampView(wide, { mode: 'yard', width: 300, height: 400 });
    expect(narrow.panX).toBeCloseTo(0.75 * 0.5, 9);
  });
});

describe('chase view', () => {
  const chase: ViewContext = { mode: 'chase', width: 600, height: 400 };

  it('orbits on a horizontal drag and tilts on a vertical one', () => {
    const dragged = panBy(DEFAULT_TOP_DOWN_VIEW, -50, 80, chase);
    expect(dragged.panX).toBeGreaterThan(0);
    expect(dragged.panY).toBeGreaterThan(0);
    expect(panBy(DEFAULT_TOP_DOWN_VIEW, 50, 0, chase).panX).toBeLessThan(0);
  });

  it('wraps the yaw at a full turn and clamps the tilt at both ends', () => {
    const turned = panBy(DEFAULT_TOP_DOWN_VIEW, -(2 * Math.PI) / 0.01 - 30, 0, chase);
    expect(turned.panX).toBeCloseTo(panBy(DEFAULT_TOP_DOWN_VIEW, -30, 0, chase).panX, 9);
    expect(Math.abs(panBy(DEFAULT_TOP_DOWN_VIEW, -1e6, 0, chase).panX)).toBeLessThanOrEqual(
      Math.PI,
    );
    expect(panBy(DEFAULT_TOP_DOWN_VIEW, 0, 1e6, chase).panY).toBe(CHASE_TILT.max);
    expect(panBy(DEFAULT_TOP_DOWN_VIEW, 0, -1e6, chase).panY).toBe(CHASE_TILT.min);
  });

  it('turns any angle into (-π, π]', () => {
    expect(wrapAngle(Math.PI)).toBe(Math.PI);
    expect(wrapAngle(-Math.PI)).toBe(Math.PI);
    expect(wrapAngle(3 * Math.PI)).toBe(Math.PI);
    expect(wrapAngle(0.5 - 4 * Math.PI)).toBeCloseTo(0.5, 12);
  });

  it('clamps the distance at both ends, whatever the anchor', () => {
    const at = { x: 10, y: 10 };
    expect(zoomAt(DEFAULT_TOP_DOWN_VIEW, 100, at, chase)).toEqual({
      zoom: ZOOM_LIMITS.chase.max,
      panX: 0,
      panY: 0,
    });
    expect(zoomAt(DEFAULT_TOP_DOWN_VIEW, 0.001, at, chase).zoom).toBe(ZOOM_LIMITS.chase.min);
  });

  it('clamps the tilt and the zoom of a view and keeps its yaw', () => {
    expect(clampView(view(1, 0.2, -3), chase)).toMatchObject({ panX: 0.2, panY: CHASE_TILT.min });
    expect(clampView(view(100, 7, 0), chase)).toMatchObject({ zoom: ZOOM_LIMITS.chase.max });
  });

  it('turns a pinch about a fixed midpoint into distance only', () => {
    const next = pinch(
      DEFAULT_TOP_DOWN_VIEW,
      [
        { x: 250, y: 200 },
        { x: 350, y: 200 },
      ],
      [
        { x: 200, y: 200 },
        { x: 400, y: 200 },
      ],
      chase,
    );
    expect(next).toEqual({ zoom: 2, panX: 0, panY: 0 });
  });

  it('turns a moving midpoint into yaw and the finger spread into distance together', () => {
    const next = pinch(
      DEFAULT_TOP_DOWN_VIEW,
      [
        { x: 250, y: 200 },
        { x: 350, y: 200 },
      ],
      [
        { x: 230, y: 210 },
        { x: 430, y: 210 },
      ],
      chase,
    );
    expect(next.zoom).toBeCloseTo(2, 9);
    expect(next.panX).toBeCloseTo(panBy(DEFAULT_TOP_DOWN_VIEW, 30, 10, chase).panX, 9);
    expect(next.panX).toBeLessThan(0);
    expect(next.panY).toBeCloseTo(panBy(DEFAULT_TOP_DOWN_VIEW, 30, 10, chase).panY, 9);
  });
});

describe('wheelFactor', () => {
  it('zooms in for negative deltaY and out for positive', () => {
    expect(wheelFactor(-100, 0, false, 400)).toBeGreaterThan(1);
    expect(wheelFactor(100, 0, false, 400)).toBeLessThan(1);
  });

  it('is inverse for opposite deltas', () => {
    expect(wheelFactor(37, 0, false, 400) * wheelFactor(-37, 0, false, 400)).toBeCloseTo(1, 12);
  });

  it('scales line and page deltas and pinch gestures', () => {
    expect(wheelFactor(1, 1, false, 400)).toBeCloseTo(wheelFactor(16, 0, false, 400), 12);
    expect(wheelFactor(1, 2, false, 400)).toBeCloseTo(wheelFactor(400, 0, false, 400), 12);
    expect(wheelFactor(2, 0, true, 400)).toBeCloseTo(wheelFactor(10, 0, false, 400), 12);
  });
});

describe('isDefaultView', () => {
  it('tolerates float noise only', () => {
    expect(isDefaultView(DEFAULT_TOP_DOWN_VIEW)).toBe(true);
    expect(isDefaultView(view(1 + 1e-9, 1e-9, -1e-9))).toBe(true);
    expect(isDefaultView(view(1.01))).toBe(false);
    expect(isDefaultView(view(1, 0.01))).toBe(false);
  });
});
