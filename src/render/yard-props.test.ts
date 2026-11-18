import { Box3, Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { exercises, layouts } from '../content/registry';
import { resolveLayout } from '../content/resolve-layout';
import type { ObstacleKind } from '../contracts/layout';
import { cornerHoops, plotGoods, RESTYLED_KINDS, yardProps } from './yard-props';

const TOLERANCE = 0.05;
const MAX_RELIEF = 0.16; // thin relief only, as for seals and dock lights
const FILLS_FOOTPRINT: readonly ObstacleKind[] = ['parked', 'gatehouse', 'bollard'];
const FILLS_AXES: readonly ObstacleKind[] = ['kerb', 'wall', 'ramp', 'cone'];

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

  it('fill the footprint of kerbs, walls, ramps and cones without outgrowing it', () => {
    const plot = yardProps({ ...resolved, obstacles: [] }).length;
    const concrete = resolved.obstacles.filter((o) => FILLS_AXES.includes(o.kind));
    for (const o of concrete) {
      const b = new Box3();
      const own = yardProps({ ...resolved, obstacles: [o] });
      for (const p of own.slice(0, own.length - plot)) {
        b.union(new Box3().setFromObject(new Mesh(p.geometry)));
      }
      const { cx, cy, heading, halfLength, halfWidth } = o.obb;
      const [c, s] = [Math.abs(Math.cos(heading)), Math.abs(Math.sin(heading))];
      const halfX = c * halfLength + s * halfWidth;
      const halfY = s * halfLength + c * halfWidth;
      expect(b.min.x, o.id).toBeCloseTo(cx - halfX, 1);
      expect(b.max.x, o.id).toBeCloseTo(cx + halfX, 1);
      expect(-b.max.z, o.id).toBeCloseTo(cy - halfY, 1);
      expect(-b.min.z, o.id).toBeCloseTo(cy + halfY, 1);
      expect(b.max.y, o.id).toBeLessThanOrEqual(o.height + MAX_RELIEF);
    }
  });

  it('keep loose plot goods behind the yard edge and inside the layout bounds', () => {
    const { yard, bounds } = resolved;
    for (const piece of plotGoods(yard)) {
      const b = new Box3().setFromObject(new Mesh(piece.geometry));
      expect(-b.max.z).toBeGreaterThan(yard.maxY);
      expect(-b.min.z).toBeLessThan(bounds.maxY);
      expect(b.min.x).toBeGreaterThan(bounds.minX);
      expect(b.max.x).toBeLessThan(bounds.maxX);
    }
  });

  it('yield a piece for every restyled kind present', () => {
    for (const kind of RESTYLED_KINDS) {
      const obstacles = resolved.obstacles.filter((o) => o.kind === kind);
      if (obstacles.length === 0) continue;
      const baseline = yardProps({ ...resolved, obstacles: [] }).length;
      expect(yardProps({ ...resolved, obstacles }).length, kind).toBeGreaterThan(baseline);
    }
  });
});

describe('corner hoops', () => {
  it('stand within thin relief of the hall block', () => {
    const hall = { minX: 10, minY: 52, maxX: 74, maxY: 68 };
    const pieces = cornerHoops(hall);
    expect(pieces).toHaveLength(4);
    for (const { geometry } of pieces) {
      const b = new Box3().setFromObject(new Mesh(geometry));
      expect(hall.minX - b.min.x).toBeLessThanOrEqual(MAX_RELIEF);
      expect(b.max.x - hall.maxX).toBeLessThanOrEqual(MAX_RELIEF);
      expect(-b.max.z - (hall.minY - MAX_RELIEF)).toBeGreaterThanOrEqual(0);
      expect(-b.min.z - (hall.maxY + MAX_RELIEF)).toBeLessThanOrEqual(0);
    }
  });
});
