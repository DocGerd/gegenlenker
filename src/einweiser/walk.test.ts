import { describe, expect, it } from 'vitest';
import type { Rect2 } from '../contracts/layout';
import { DT } from '../sim/constants';
import type { Occluder } from './sight';
import { overlaps, WALK_SPEED, WALKER_RADIUS, type WalkKeys, type Walker, walkStep } from './walk';

const YARD: Rect2 = { minX: -50, minY: -50, maxX: 50, maxY: 50 };
const KEYS: WalkKeys = { forward: false, back: false, left: false, right: false, jog: false };
const box = (cx: number, height: number): Occluder => ({
  obb: { cx, cy: 0, halfLength: 0.5, halfWidth: 5, heading: 0 },
  height,
});

function walk(from: Walker, keys: Partial<WalkKeys>, seconds: number, colliders: Occluder[] = []) {
  let w = from;
  for (let k = 0; k < Math.round(seconds / DT); k++) {
    w = walkStep(w, { ...KEYS, ...keys }, DT, colliders, YARD);
  }
  return w;
}

describe('walking', () => {
  const still: Walker = { x: 0, y: 0, heading: Math.PI / 2, vx: 0, vy: 0 };

  it('walks in his facing frame and reaches walking speed after the ramp', () => {
    const w = walk(still, { right: true }, 1);
    expect(w.vx).toBeCloseTo(WALK_SPEED, 9);
    expect(w.vy).toBeCloseTo(0, 9);
  });

  it('slides along a wall it walks into and steps over a kerb', () => {
    const diagonal: Walker = { ...still, heading: Math.PI / 4 };
    const wall = walk(diagonal, { forward: true }, 4, [box(2, 2)]);
    expect(wall.x).toBeLessThanOrEqual(1.5 - WALKER_RADIUS + 1e-9);
    expect(wall.y).toBeGreaterThan(3);
    const kerb = walk(diagonal, { forward: true }, 4, [box(2, 0.15)]);
    expect(kerb.x).toBeGreaterThan(3);
  });

  it.each([0.3, 1.1, 2.4])('slides along a wall at heading %f without passing through', (h) => {
    const [c, s] = [Math.cos(h), Math.sin(h)];
    const wall: Occluder = {
      obb: { cx: 2 * c, cy: 2 * s, halfLength: 0.5, halfWidth: 20, heading: h },
      height: 2,
    };
    const w = walk({ ...still, heading: h + 0.5 }, { forward: true }, 4, [wall]);
    expect(c * (w.x - wall.obb.cx) + s * (w.y - wall.obb.cy)).toBeLessThanOrEqual(
      -wall.obb.halfLength - WALKER_RADIUS + 1e-6,
    );
  });

  it('never pushes him out of a body that moved into him', () => {
    const inside: Walker = { ...still, x: 1.8 };
    const body = box(2, 3);
    expect(overlaps(body.obb, inside)).toBe(true);
    expect(walk(inside, {}, 1, [body])).toMatchObject({ x: 1.8, y: 0 });
  });
});
