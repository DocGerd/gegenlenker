import type { Obstacle } from '../contracts/layout';
import type { BodyFootprint, ContactQuery, Obb, Vec2 } from '../contracts/sim';

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

const corners = (obb: Obb): Vec2[] => {
  const c = Math.cos(obb.heading);
  const s = Math.sin(obb.heading);
  return (
    [
      [1, 1],
      [-1, 1],
      [-1, -1],
      [1, -1],
    ] as const
  ).map(([u, v]) => ({
    x: obb.cx + u * obb.halfLength * c - v * obb.halfWidth * s,
    y: obb.cy + u * obb.halfLength * s + v * obb.halfWidth * c,
  }));
};

/** Sutherland-Hodgman: the part of convex `polygon` inside the box `clip`. */
const clipToBox = (polygon: Vec2[], clip: Obb): Vec2[] => {
  const c = Math.cos(clip.heading);
  const s = Math.sin(clip.heading);
  let out = polygon;
  for (const [ax, ay, limit] of [
    [c, s, clip.halfLength],
    [-c, -s, clip.halfLength],
    [-s, c, clip.halfWidth],
    [s, -c, clip.halfWidth],
  ] as const) {
    const side = (p: Vec2): number => (p.x - clip.cx) * ax + (p.y - clip.cy) * ay - limit;
    const input = out;
    out = [];
    input.forEach((cur, i) => {
      const prev = input[(i + input.length - 1) % input.length] ?? cur;
      const [dc, dp] = [side(cur), side(prev)];
      if (dc <= 0 !== dp <= 0) {
        const k = dp / (dp - dc);
        out.push({ x: prev.x + (cur.x - prev.x) * k, y: prev.y + (cur.y - prev.y) * k });
      }
      if (dc <= 0) out.push(cur);
    });
  }
  return out;
};

/** Area centroid of the overlap of two boxes: the ground point where they touch. */
export const contactPoint = (a: Obb, b: Obb): Vec2 => {
  const poly = clipToBox(corners(a), b);
  let area = 0;
  let [gx, gy] = [0, 0];
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length] ?? p;
    const cross = p.x * q.y - q.x * p.y;
    area += cross;
    gx += (p.x + q.x) * cross;
    gy += (p.y + q.y) * cross;
  });
  if (Math.abs(area) < 1e-12) {
    // a sliver has no usable centroid: fall back to the vertex mean, or the box midpoint
    const n = poly.length;
    if (n === 0) return { x: (a.cx + b.cx) / 2, y: (a.cy + b.cy) / 2 };
    return {
      x: poly.reduce((sum, p) => sum + p.x, 0) / n,
      y: poly.reduce((sum, p) => sum + p.y, 0) / n,
    };
  }
  return { x: gx / (3 * area), y: gy / (3 * area) };
};

const hit = (a: Obb, b: Obb): boolean =>
  Math.hypot(b.cx - a.cx, b.cy - a.cy) <= radius(a) + radius(b) && obbOverlap(a, b);

/** `obstacleId` of a truck-against-trailer contact. */
export const SELF_OBSTACLE_ID = 'self';

export const createContactQuery =
  (obstacles: readonly Obstacle[]): ContactQuery =>
  (bodies: readonly BodyFootprint[]) => {
    for (const { body, obb } of bodies) {
      for (const obstacle of obstacles) {
        if (hit(obb, obstacle.obb)) {
          return { body, obstacleId: obstacle.id, point: contactPoint(obb, obstacle.obb) };
        }
      }
    }
    const truck = bodies.find((b) => b.body === 'truck');
    const trailer = bodies.find((b) => b.body === 'trailer');
    if (truck && trailer && hit(truck.obb, trailer.obb)) {
      return {
        body: 'trailer',
        obstacleId: SELF_OBSTACLE_ID,
        point: contactPoint(truck.obb, trailer.obb),
      };
    }
    return null;
  };
