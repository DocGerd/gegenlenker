import { describe, expect, it } from 'vitest';
import type { Obstacle } from '../contracts/layout';
import type { BodyFootprint, Obb } from '../contracts/sim';
import { createContactQuery, obbOverlap, OVERLAP_EPSILON } from './collision';

const box = (cx: number, cy: number, halfLength: number, halfWidth: number, heading = 0): Obb => ({
  cx,
  cy,
  halfLength,
  halfWidth,
  heading,
});
const obstacle = (id: string, obb: Obb): Obstacle => ({ id, kind: 'wall', obb, height: 1 });

describe('obbOverlap', () => {
  it('separated boxes do not overlap', () => {
    expect(obbOverlap(box(0, 0, 1, 1), box(5, 0, 1, 1))).toBe(false);
    expect(obbOverlap(box(0, 0, 1, 1), box(0, 5, 1, 1, 0.3))).toBe(false);
  });

  it('overlapping boxes overlap', () => {
    expect(obbOverlap(box(0, 0, 1, 1), box(1.5, 0.5, 1, 1, 0.4))).toBe(true);
  });

  it('touching is not a contact', () => {
    const rear = 10;
    const ramp = (gap: number) => box(rear + gap + 1, 0, 1, 2);
    const trailer = box(rear - 3, 0, 3, 1.25);
    expect(obbOverlap(trailer, ramp(0))).toBe(false);
    expect(obbOverlap(trailer, ramp(1e-7))).toBe(false);
    expect(obbOverlap(trailer, ramp(-1e-4))).toBe(true);
    expect(OVERLAP_EPSILON).toBe(1e-6);
  });

  it('uses the oriented boxes, not their bounds', () => {
    const quarter = Math.PI / 4;
    const a = box(0, 0, 0.5, 0.5, quarter);
    const offset = (gap: number) => (1 + gap) / Math.SQRT2;
    const b = (gap: number) => box(offset(gap), offset(gap), 0.5, 0.5, quarter);
    // the diamonds' axis-aligned bounds intersect (offset < half-diagonal sum)
    expect(offset(0.05)).toBeLessThan(2 * Math.SQRT1_2);
    expect(obbOverlap(a, b(0.05))).toBe(false);
    expect(obbOverlap(a, b(-0.05))).toBe(true);
  });

  it('tests the axes of each box, not only the first', () => {
    const aligned = box(0, 0, 0.5, 0.5);
    // separated only along the rotated box's diagonal axis
    const rotated = (gap: number) => {
      const c = (0.5 * Math.SQRT2 + 0.5 + gap) / Math.SQRT2;
      return box(c, c, 0.5, 0.5, Math.PI / 4);
    };
    expect(obbOverlap(aligned, rotated(0.05))).toBe(false);
    expect(obbOverlap(rotated(0.05), aligned)).toBe(false);
    expect(obbOverlap(aligned, rotated(-0.05))).toBe(true);
  });

  it('a box inside another overlaps', () => {
    expect(obbOverlap(box(0, 0, 5, 5), box(0.5, 0.5, 1, 1, 0.7))).toBe(true);
    expect(obbOverlap(box(0.5, 0.5, 1, 1, 0.7), box(0, 0, 5, 5))).toBe(true);
  });
});

describe('createContactQuery', () => {
  const truck = (obb: Obb): BodyFootprint => ({ body: 'truck', obb });
  const drawbar = (obb: Obb): BodyFootprint => ({ body: 'drawbar', obb });
  const trailer = (obb: Obb): BodyFootprint => ({ body: 'trailer', obb });
  const clearTruck = box(0, 0, 3, 1.25);
  const clearDrawbar = box(-5, 0, 1, 0.2);
  const clearTrailer = box(-12, 0, 4, 1.25);

  it('finds the first obstacle in body then obstacle order', () => {
    const query = createContactQuery([
      obstacle('a', box(50, 50, 1, 1)),
      obstacle('b', box(-12, 0, 1, 1)),
      obstacle('c', box(0, 0, 1, 1)),
    ]);
    expect(query([truck(clearTruck), drawbar(clearDrawbar), trailer(clearTrailer)])).toEqual({
      body: 'truck',
      obstacleId: 'c',
    });
  });

  it('reports truck against trailer body as self', () => {
    const query = createContactQuery([]);
    const overlapping = box(-1, 0, 4, 1.25);
    expect(query([truck(clearTruck), drawbar(clearDrawbar), trailer(overlapping)])).toEqual({
      body: 'trailer',
      obstacleId: 'self',
    });
  });

  it('ignores the jointed pairs truck–drawbar and drawbar–trailer', () => {
    const query = createContactQuery([]);
    const jointed = box(-4, 0, 1.5, 0.2); // overlaps truck [-3, 3] and trailer [-13, -5]
    expect(query([truck(clearTruck), drawbar(jointed), trailer(box(-9, 0, 4, 1.25))])).toBeNull();
  });

  it('returns null when clear', () => {
    const query = createContactQuery([obstacle('a', box(50, 50, 1, 1))]);
    expect(query([truck(clearTruck), drawbar(clearDrawbar), trailer(clearTrailer)])).toBeNull();
  });
});
