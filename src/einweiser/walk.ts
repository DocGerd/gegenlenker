import type { Rect2 } from '../contracts/layout';
import type { Obb, Pose2, SimSnapshot, Vec2 } from '../contracts/sim';
import type { VehicleParams } from '../contracts/vehicle';
import type { Occluder } from './sight';

/** Walker measures and speeds (estimates; walk after Weidmann's 1.34 m/s mean). */
export const WALKER_RADIUS = 0.25;
export const WALK_SPEED = 1.4;
export const JOG_SPEED = 3;
/** Seconds from standing to full speed. */
export const WALK_RAMP = 0.2;
/** Lower obstacles, such as kerbs, are stepped over. */
export const STEP_HEIGHT = 0.3;
/** He starts this far behind the trailer rear, and this far outboard of its left side. */
export const START_BEHIND = 3;
export const START_OUTBOARD = 1;

/** The Einweiser's pose (heading = facing, set by look) and his walking velocity. */
export type Walker = Pose2 & { readonly vx: number; readonly vy: number };
/** Held walk keys, in his facing frame. */
export type WalkKeys = {
  readonly forward: boolean;
  readonly back: boolean;
  readonly left: boolean;
  readonly right: boolean;
  readonly jog: boolean;
};

/** Where his circle at `p` overlaps the box, the push that clears it; null when clear. */
function push(obb: Obb, p: Vec2, radius: number): Vec2 | null {
  const [c, s] = [Math.cos(obb.heading), Math.sin(obb.heading)];
  const [dx, dy] = [p.x - obb.cx, p.y - obb.cy];
  const lx = c * dx + s * dy;
  const ly = -s * dx + c * dy;
  const qx = Math.max(-obb.halfLength, Math.min(obb.halfLength, lx));
  const qy = Math.max(-obb.halfWidth, Math.min(obb.halfWidth, ly));
  let [nx, ny] = [lx - qx, ly - qy];
  let depth: number;
  const d = Math.hypot(nx, ny);
  if (d > 0) {
    if (d >= radius) return null;
    depth = radius - d;
    [nx, ny] = [nx / d, ny / d];
  } else {
    // the centre is inside: out through the nearer face
    const fx = obb.halfLength - Math.abs(lx);
    const fy = obb.halfWidth - Math.abs(ly);
    [nx, ny] = fx < fy ? [Math.sign(lx) || 1, 0] : [0, Math.sign(ly) || 1];
    depth = Math.min(fx, fy) + radius;
  }
  return { x: depth * (c * nx - s * ny), y: depth * (s * nx + c * ny) };
}

/** The overlap (m) rounding can leave after a slide along a rotated box: only a deeper one is a body that moved into him. */
const SLIDE_ROUNDING = 1e-6;

/** Whether his circle at `p` overlaps the box. */
export const overlaps = (obb: Obb, p: Vec2, radius = WALKER_RADIUS): boolean =>
  push(obb, p, radius) !== null;

/**
 * One step of walking: the held keys set a velocity in his facing frame, reached over `WALK_RAMP`;
 * the move slides along every collider at least `STEP_HEIGHT` tall and stays in the yard. It only clips
 * his own motion: a collider he already overlaps (a body that moved into him) does not push him out.
 */
export function walkStep(
  w: Walker,
  held: WalkKeys,
  dt: number,
  colliders: readonly Occluder[],
  yard: Rect2,
): Walker {
  const along = Number(held.forward) - Number(held.back);
  const across = Number(held.left) - Number(held.right);
  const top = held.jog ? JOG_SPEED : WALK_SPEED;
  const scale = along === 0 && across === 0 ? 0 : top / Math.hypot(along, across);
  const [c, s] = [Math.cos(w.heading), Math.sin(w.heading)];
  const target = { x: scale * (c * along - s * across), y: scale * (s * along + c * across) };
  const gap = Math.hypot(target.x - w.vx, target.y - w.vy);
  const reach = Math.min(1, gap === 0 ? 1 : ((top / WALK_RAMP) * dt) / gap);
  let vx = w.vx + reach * (target.x - w.vx);
  let vy = w.vy + reach * (target.y - w.vy);

  const blocking = colliders.filter(
    (o) => o.height >= STEP_HEIGHT && !overlaps(o.obb, w, WALKER_RADIUS - SLIDE_ROUNDING),
  );
  let p = { x: w.x + vx * dt, y: w.y + vy * dt };
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const o of blocking) {
      const out = push(o.obb, p, WALKER_RADIUS);
      if (out === null) continue;
      p = { x: p.x + out.x, y: p.y + out.y };
      const n = Math.hypot(out.x, out.y);
      const into = (vx * out.x + vy * out.y) / n;
      if (into < 0) [vx, vy] = [vx - (into * out.x) / n, vy - (into * out.y) / n];
      moved = true;
    }
    if (!moved) break;
  }
  const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
  const x = clamp(p.x, yard.minX + WALKER_RADIUS, yard.maxX - WALKER_RADIUS);
  const y = clamp(p.y, yard.minY + WALKER_RADIUS, yard.maxY - WALKER_RADIUS);
  if (x !== p.x) vx = 0;
  if (y !== p.y) vy = 0;
  return { x, y, heading: w.heading, vx, vy };
}

/** His start: behind the trailer rear, out to its left (the driver's side), facing along the trailer. */
export function startWalker(params: VehicleParams, s: SimSnapshot): Walker {
  const h = s.trailer.heading;
  const out = params.trailerWidth / 2 + START_OUTBOARD;
  return {
    x: s.trailerRear.x - START_BEHIND * Math.cos(h) - out * Math.sin(h),
    y: s.trailerRear.y - START_BEHIND * Math.sin(h) + out * Math.cos(h),
    heading: h,
    vx: 0,
    vy: 0,
  };
}
