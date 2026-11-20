import { describe, expect, it } from 'vitest';
import { layouts } from '../content/registry';
import { resolveLayout } from '../content/resolve-layout';
import type { Marking } from '../contracts/layout';
import { rectGeometry } from './ground-geometry';
import { addMarkBox, edgeKeep, MARK_BOX, WEAR_CAP, wearAt } from './marking-wear';

const STEP = 0.01;

/** Wear summed over a stroke's area, sampled on a grid, and the most wear seen within the kept edge. */
function sample(marking: Marking): {
  sum: number;
  count: number;
  coverage: number;
  keptEdge: number;
} {
  const dx = marking.to.x - marking.from.x;
  const dy = marking.to.y - marking.from.y;
  const length = Math.hypot(dx, dy);
  const [ux, uy] = [dx / length, dy / length];
  const half = marking.width / 2;
  const keep = edgeKeep(half);
  let sum = 0;
  let count = 0;
  let keptEdge = 0;
  for (let along = STEP / 2; along < length; along += STEP) {
    for (let across = -half + STEP / 2; across < half; across += STEP) {
      const x = marking.from.x + ux * along - uy * across;
      const y = marking.from.y + uy * along + ux * across;
      const edge = Math.min(along, length - along, half - Math.abs(across));
      const wear = wearAt(x, -y, edge, half);
      sum += wear;
      count++;
      if (edge <= keep) keptEdge = Math.max(keptEdge, wear);
    }
  }
  return { sum, count, coverage: sum / count, keptEdge };
}

const strokes = (kind: Marking['kind']): Marking[] =>
  Object.values(layouts).flatMap((l) =>
    resolveLayout(l, null).markings.filter((m) => m.kind === kind && !m.dashed),
  );

describe('worn marking paint', () => {
  it('wears no more than the cap of the paint of any kind, and of any bay', () => {
    for (const kind of ['bay', 'stop', 'arrow', 'dock-number'] as const) {
      const all = strokes(kind).map(sample);
      const total = all.reduce((n, s) => n + s.count, 0);
      expect(all.reduce((n, s) => n + s.sum, 0) / total, kind).toBeLessThanOrEqual(WEAR_CAP);
      if (kind === 'bay') for (const s of all) expect(s.coverage).toBeLessThanOrEqual(WEAR_CAP);
    }
  });

  it('leaves the edge of every stroke unworn', () => {
    for (const kind of ['bay', 'stop', 'arrow', 'dock-number'] as const) {
      for (const marking of strokes(kind).slice(0, 12)) {
        expect(sample(marking).keptEdge, kind).toBe(0);
      }
    }
  });

  it('wears the bays alike, with no hint of where the target is', () => {
    const bays = strokes('bay').filter((m) => Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y) > 4);
    expect(bays.length).toBeGreaterThan(4);
    const coverage = bays.map((m) => sample(m).coverage);
    const mean = coverage.reduce((a, b) => a + b, 0) / coverage.length;
    expect(mean).toBeGreaterThan(0.05);
    for (const c of coverage) expect(Math.abs(c - mean)).toBeLessThan(0.1);
  });

  it('is a pure function of position and edge distance', () => {
    expect(wearAt(12.3, -4.5, 0.04, 0.06)).toBe(wearAt(12.3, -4.5, 0.04, 0.06));
  });
});

describe('marking quads', () => {
  it('records each quad as its local position and half extents, rotated and moved or not', () => {
    const geometry = rectGeometry(-2, 2, -0.1, 0.1).rotateY(0.7).translate(5, 0.01, -3);
    expect(addMarkBox(geometry)).toBe(true);
    const box = geometry.getAttribute(MARK_BOX);
    expect(box.count).toBe(4);
    for (let i = 0; i < 4; i++) {
      expect(Math.abs(box.getX(i))).toBeCloseTo(2);
      expect(Math.abs(box.getY(i))).toBeCloseTo(0.1);
      expect(box.getZ(i)).toBeCloseTo(2);
      expect(box.getW(i)).toBeCloseTo(0.1);
    }
  });

  it('leaves geometry that is not whole quads alone', () => {
    const geometry = rectGeometry(0, 1, 0, 1);
    geometry.deleteAttribute('normal');
    expect(addMarkBox(geometry.toNonIndexed())).toBe(false);
  });
});
