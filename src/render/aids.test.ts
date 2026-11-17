import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../contracts/sim';
import { dashSegments } from './aids';

type Dash = { from: Vec2; to: Vec2 };

const dashes = (line: readonly Vec2[], on: number, off: number): Dash[] => {
  const out: Dash[] = [];
  dashSegments(line, on, off, (ax, ay, bx, by) =>
    out.push({ from: { x: ax, y: ay }, to: { x: bx, y: by } }),
  );
  return out;
};

const total = (ds: readonly Dash[]): number =>
  ds.reduce((sum, d) => sum + Math.hypot(d.to.x - d.from.x, d.to.y - d.from.y), 0);

const straight = (length: number, spacing: number): Vec2[] => {
  const n = Math.round(length / spacing);
  return Array.from({ length: n + 1 }, (_, i) => ({ x: (i * length) / n, y: 0 }));
};

describe('dashSegments', () => {
  it('lays on/period of the length down as dashes, independent of the vertex spacing', () => {
    for (const spacing of [0.3, 0.5]) {
      expect(total(dashes(straight(30, spacing), 0.6, 0.4))).toBeCloseTo(18, 6);
    }
  });

  it('measures the pattern along the line, so dashes start at each period', () => {
    for (const spacing of [0.3, 0.5]) {
      // a dash crossing a vertex is emitted in pieces; a start is a piece that does not continue the last
      const pieces = dashes(straight(3, spacing), 0.6, 0.4);
      const starts = pieces
        .filter((d, i) => i === 0 || d.from.x - (pieces[i - 1]?.to.x ?? 0) > 1e-9)
        .map((d) => d.from.x);
      expect(starts).toHaveLength(3);
      [0, 1, 2].forEach((x, i) => expect(starts[i]).toBeCloseTo(x, 9));
    }
  });

  it('terminates on a long chord, where float error leaves a sliver at the end of a dash', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    expect(total(dashes(line, 0.6, 0.4))).toBeCloseTo(6, 6);
  });
});
