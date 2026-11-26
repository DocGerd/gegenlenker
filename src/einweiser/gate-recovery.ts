/**
 * Test-only: the geometry of the gate Einweiser's recovery (`gate-harness.ts`): pull straight forward
 * until the combination is straight, then a fresh reverse path onto the leg's final straight.
 */
import type { Pose2 } from '../contracts/sim';
import type { VehicleParams } from '../contracts/vehicle';
import { couplingAngle, rk4, turntableAngle, type KinematicState } from '../sim/kinematics';

/** A straight (`k` 0) or an arc of curvature `k` (left turn positive), `len` metres long. */
export type Segment = { readonly len: number; readonly k: number };

const STEP = 0.05;

/**
 * Pulls straight forward along the truck heading (road wheels straight) until coupling and turntable
 * are both within `tolerance` (rad), `max` metres are driven, or the next step is not `clear`.
 */
export function straighten(
  p: VehicleParams,
  from: KinematicState,
  tolerance: number,
  max: number,
  clear: (q: KinematicState) => boolean,
): { readonly distance: number; readonly state: KinematicState } {
  let q = from;
  let distance = 0;
  while (distance < max - 1e-9) {
    if (Math.abs(couplingAngle(q)) <= tolerance && Math.abs(turntableAngle(q)) <= tolerance) break;
    const next = rk4(p, q, 1, 0, STEP);
    if (!clear(next)) break;
    q = next;
    distance += STEP;
  }
  return { distance, state: q };
}

/** The pose after `segments` from `from`, integrated exactly. */
export function endOf(from: Pose2, segments: readonly Segment[]): Pose2 {
  let { x, y, heading: h } = from;
  for (const { len, k } of segments) {
    if (k === 0) {
      x += len * Math.cos(h);
      y += len * Math.sin(h);
    } else {
      x += (Math.sin(h + k * len) - Math.sin(h)) / k;
      y += (Math.cos(h) - Math.cos(h + k * len)) / k;
      h += k * len;
    }
  }
  return { x, y, heading: h };
}

const TAU = 2 * Math.PI;
const turn = (a: number): number => ((a % TAU) + TAU) % TAU;
const pathLength = (segments: readonly Segment[]): number =>
  segments.reduce((sum, s) => sum + s.len, 0);

/**
 * The arc–straight–arc paths of radius `r` from `from` to `to` (headings are directions of motion),
 * shortest first: left or right arcs at either end, joined by their common tangent.
 */
export function dubinsPaths(from: Pose2, to: Pose2, r: number): Segment[][] {
  const centre = (at: Pose2, side: 1 | -1) => ({
    x: at.x - side * r * Math.sin(at.heading),
    y: at.y + side * r * Math.cos(at.heading),
  });
  const out: Segment[][] = [];
  for (const a of [1, -1] as const) {
    for (const b of [1, -1] as const) {
      const c0 = centre(from, a);
      const c1 = centre(to, b);
      const [dx, dy] = [c1.x - c0.x, c1.y - c0.y];
      const d = Math.hypot(dx, dy);
      let heading: number;
      let straight: number;
      if (a === b) {
        heading = Math.atan2(dy, dx);
        straight = d;
      } else {
        if (d < 2 * r) continue;
        straight = Math.sqrt(d * d - 4 * r * r);
        // the inner tangent leaves the first circle turned toward the second
        heading = Math.atan2(dy, dx) + a * Math.atan2(2 * r, straight);
      }
      const first = turn(a * (heading - from.heading)) * r;
      const last = turn(b * (to.heading - heading)) * r;
      out.push([
        { len: first, k: a / r },
        { len: straight, k: 0 },
        { len: last, k: b / r },
      ]);
    }
  }
  return out.sort((x, y) => pathLength(x) - pathLength(y));
}

/** A point on a path; `h` is its direction of motion. */
export type Waypoint = { readonly x: number; readonly y: number; readonly h: number };

/**
 * The shortest way from `from` onto `path` (points `ds` apart): a loop-free arc–straight–arc path of
 * radius `r` (no arc past `maxTurn`) to one of `joins` that `fits`, then the rest of `path`.
 */
export function rejoin(
  from: Pose2,
  path: readonly Waypoint[],
  joins: readonly number[],
  ds: number,
  r: number,
  maxTurn: number,
  fits: (from: Pose2, segments: readonly Segment[]) => boolean,
): { readonly segments: Segment[]; readonly join: number; readonly length: number } | null {
  let best: { segments: Segment[]; join: number; length: number } | null = null;
  for (const join of joins) {
    const at = path[join];
    if (!at) continue;
    const rest = (path.length - 1 - join) * ds;
    for (const segments of dubinsPaths(from, { x: at.x, y: at.y, heading: at.h }, r)) {
      const length = pathLength(segments) + rest;
      if (best !== null && length >= best.length) break;
      if (segments.some((g) => g.k !== 0 && Math.abs(g.k) * g.len > maxTurn)) continue;
      if (!fits(from, segments)) continue;
      best = { segments, join, length };
      break;
    }
  }
  return best;
}
