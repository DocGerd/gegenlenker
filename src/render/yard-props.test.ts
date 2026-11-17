import { Box3, Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { exercises, layouts } from '../content/registry';
import { resolveLayout } from '../content/resolve-layout';
import type { ObstacleKind } from '../contracts/layout';
import { RESTYLED_KINDS, yardProps } from './yard-props';

const TOLERANCE = 0.05;
const FILLS_FOOTPRINT: readonly ObstacleKind[] = ['parked', 'gatehouse', 'bollard'];

const cases = [
  ...Object.values(layouts).map((l) => ({ name: l.id, resolved: resolveLayout(l, null) })),
  ...exercises.map((e) => ({ name: e.id, resolved: resolveLayout(layouts[e.layout], e) })),
];

describe.each(cases)('$name yard props', ({ resolved }) => {
  it('draw a detail copy over the whole footprint of solid props', () => {
    const boxes = yardProps(resolved).map((p) => new Box3().setFromObject(new Mesh(p.geometry)));
    const solid = resolved.obstacles.filter((o) => FILLS_FOOTPRINT.includes(o.kind));
    for (const { id, obb } of solid) {
      const { cx, cy, halfLength, halfWidth } = obb;
      const covers = boxes.some(
        (b) =>
          Math.abs(b.min.x - (cx - halfLength)) < TOLERANCE &&
          Math.abs(b.max.x - (cx + halfLength)) < TOLERANCE &&
          Math.abs(b.min.z + (cy + halfWidth)) < TOLERANCE &&
          Math.abs(b.max.z + (cy - halfWidth)) < TOLERANCE,
      );
      expect(covers, id).toBe(true);
    }
  });

  it('yield a piece for every restyled kind present', () => {
    for (const kind of RESTYLED_KINDS) {
      const obstacles = resolved.obstacles.filter((o) => o.kind === kind);
      if (obstacles.length === 0) continue;
      expect(yardProps({ ...resolved, obstacles }).length, kind).toBeGreaterThan(0);
    }
  });
});
