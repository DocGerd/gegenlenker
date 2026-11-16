import type { Obstacle } from '../contracts/layout';
import type { BodyFootprint, ContactQuery, Obb } from '../contracts/sim';

/** Minimum penetration depth (m) that counts as overlap; flush contact is not a contact. */
export const OVERLAP_EPSILON = 1e-6;

const radius = (obb: Obb): number => Math.hypot(obb.halfLength, obb.halfWidth);

/** Half-extent of `obb` projected onto the unit axis (ax, ay). */
const support = (obb: Obb, ax: number, ay: number): number => {
  const c = Math.cos(obb.heading);
  const s = Math.sin(obb.heading);
  return obb.halfLength * Math.abs(c * ax + s * ay) + obb.halfWidth * Math.abs(-s * ax + c * ay);
};

/** Separating-axis test on the four box axes. */
export const obbOverlap = (a: Obb, b: Obb): boolean => {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  for (const box of [a, b]) {
    const c = Math.cos(box.heading);
    const s = Math.sin(box.heading);
    for (const [ax, ay] of [
      [c, s],
      [-s, c],
    ] as const) {
      const depth = support(a, ax, ay) + support(b, ax, ay) - Math.abs(dx * ax + dy * ay);
      if (depth <= OVERLAP_EPSILON) return false;
    }
  }
  return true;
};

const hit = (a: Obb, b: Obb): boolean =>
  Math.hypot(b.cx - a.cx, b.cy - a.cy) <= radius(a) + radius(b) && obbOverlap(a, b);

export const createContactQuery =
  (obstacles: readonly Obstacle[]): ContactQuery =>
  (bodies: readonly BodyFootprint[]) => {
    for (const { body, obb } of bodies) {
      for (const obstacle of obstacles) {
        if (hit(obb, obstacle.obb)) return { body, obstacleId: obstacle.id };
      }
    }
    const truck = bodies.find((b) => b.body === 'truck');
    const trailer = bodies.find((b) => b.body === 'trailer');
    if (truck && trailer && hit(truck.obb, trailer.obb)) {
      return { body: 'trailer', obstacleId: 'self' };
    }
    return null;
  };
