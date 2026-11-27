import type { Sight } from '../contracts/einweiser';
import type { ResolvedLayout } from '../contracts/layout';
import type { BodyId, Obb, Pose2, SimSnapshot, Vec2 } from '../contracts/sim';
import type { MirrorId, TrailerSpec, TruckSpec, Vec3, VehicleParams } from '../contracts/vehicle';
import { bodyFootprints } from '../sim/geometry';
import { COUPLING_HEIGHT, truckAnchors } from '../vehicles/anchors';
import { type CabGlass, cabGlass, metres } from '../vehicles/cab';
import { mirrorMounts, mirrorOptics } from '../vehicles/mirrors';
import { resolveCombination } from '../vehicles/resolve';

/** A 2.5D box from the ground up to `height`, world frame. */
export type Occluder = { readonly obb: Obb; readonly height: number };
export type { Sight };

/** The Einweiser's head and chest above the ground (estimates): seen if either is. */
export const HEAD_HEIGHT = 1.6;
export const CHEST_HEIGHT = 1.3;

export const bodyPoints = ({ x, y }: Vec2): Vec3[] => [
  { x, y, z: HEAD_HEIGHT },
  { x, y, z: CHEST_HEIGHT },
];

type MirrorView = {
  readonly id: MirrorId;
  readonly mount: Vec3;
  readonly yaw: number;
  readonly pitch: number;
  readonly roll: number;
  /** Tangents of the vertical and horizontal half-angles. */
  readonly tanV: number;
  readonly tanH: number;
};

/**
 * What the sight check reads of a combination: the full mirror set at fixed optics, whatever the
 * preset, the settings or the window, so the result never depends on graphics.
 */
export type SightGeometry = {
  readonly params: VehicleParams;
  readonly eye: Vec3;
  readonly glass: CabGlass;
  readonly mirrors: readonly MirrorView[];
  /** Each body's top above the road. */
  readonly heights: Readonly<Record<BodyId, number>>;
};

export function sightGeometry(truck: TruckSpec, trailer: TrailerSpec): SightGeometry {
  const mounts = mirrorMounts(truck);
  const ids = Object.keys(mounts) as MirrorId[];
  const deck = metres(trailer.deckHeight);
  return {
    params: resolveCombination(truck, trailer),
    eye: truckAnchors(truck).eye,
    glass: cabGlass(truck),
    mirrors: ids.map((id) => {
      const { yaw, pitch, roll, fov, aspect } = mirrorOptics(id, truck.id);
      const tanV = Math.tan((fov * Math.PI) / 360);
      return { id, mount: mounts[id], yaw, pitch, roll, tanV, tanH: aspect * tanV };
    }),
    heights: {
      truck: Math.max(metres(truck.cab.height), metres(truck.bodyTop)),
      drawbar: COUPLING_HEIGHT,
      trailer: trailer.swapBodyHeight === undefined ? deck : deck + metres(trailer.swapBodyHeight),
    },
  };
}

/** The layout's sight blockers: obstacles and decor. */
export const layoutOccluders = ({
  obstacles,
  decor,
}: Pick<ResolvedLayout, 'obstacles' | 'decor'>): Occluder[] => [
  ...obstacles.map(({ obb, height }) => ({ obb, height })),
  ...decor.map(({ footprint, height }) => ({ obb: footprint, height })),
];

type Bodies = Pick<SimSnapshot, 'truck' | 'coupling' | 'dolly' | 'trailer'>;
type BodyOccluder = Occluder & { readonly body: BodyId };

/** The combination's bodies at `s`. */
export const bodyOccluders = (g: SightGeometry, s: Bodies): BodyOccluder[] =>
  bodyFootprints(g.params, s).map(({ body, obb }) => ({ body, obb, height: g.heights[body] }));

/** Whether the segment `a`-`b` passes through the box: its ground track clipped to the box, then the lower clip end against the top. */
export function blocks(o: Occluder, a: Vec3, b: Vec3): boolean {
  const { cx, cy, halfLength, halfWidth, heading } = o.obb;
  const [c, s] = [Math.cos(heading), Math.sin(heading)];
  const local = (p: Vec3): Vec2 => ({
    x: c * (p.x - cx) + s * (p.y - cy),
    y: -s * (p.x - cx) + c * (p.y - cy),
  });
  const [p, q] = [local(a), local(b)];
  let t0 = 0;
  let t1 = 1;
  for (const [from, to, half] of [
    [p.x, q.x, halfLength],
    [p.y, q.y, halfWidth],
  ] as const) {
    const d = to - from;
    if (d === 0) {
      if (Math.abs(from) > half) return false;
      continue;
    }
    const [enter, exit] = [(-half - from) / d, (half - from) / d].sort((m, n) => m - n) as [
      number,
      number,
    ];
    t0 = Math.max(t0, enter);
    t1 = Math.min(t1, exit);
    if (t0 > t1) return false;
  }
  const z = (t: number): number => a.z + t * (b.z - a.z);
  return Math.min(z(t0), z(t1)) < o.height;
}

const clear = (occluders: readonly Occluder[], a: Vec3, b: Vec3): boolean =>
  occluders.every((o) => !blocks(o, a, b));

const toWorld = (pose: Pose2, p: Vec3): Vec3 => {
  const [c, s] = [Math.cos(pose.heading), Math.sin(pose.heading)];
  return { x: pose.x + c * p.x - s * p.y, y: pose.y + s * p.x + c * p.y, z: p.z };
};

const toBody = (pose: Pose2, p: Vec3): Vec3 => {
  const [c, s] = [Math.cos(pose.heading), Math.sin(pose.heading)];
  const [dx, dy] = [p.x - pose.x, p.y - pose.y];
  return { x: c * dx + s * dy, y: -s * dx + c * dy, z: p.z };
};

/** Whether the line from the eye to `p` (both in the truck's body frame) leaves the cab through glass. */
export function throughGlass(g: CabGlass, eye: Vec3, p: Vec3): boolean {
  const inBand = (z: number): boolean => z >= g.sill && z <= g.top;
  if (p.x > g.frontX) {
    const t = (g.frontX - eye.x) / (p.x - eye.x);
    const y = eye.y + t * (p.y - eye.y);
    if (Math.abs(y) <= g.screen && inBand(eye.z + t * (p.z - eye.z))) return true;
  }
  for (const side of [1, -1]) {
    if (side * p.y <= g.half) continue;
    const t = (side * g.half - eye.y) / (p.y - eye.y);
    const x = eye.x + t * (p.x - eye.x);
    if (x >= g.sideRear && x <= g.sideFront && inBand(eye.z + t * (p.z - eye.z))) return true;
  }
  return false;
}

/** Whether mirror `m` on a truck at `truck` frames world point `p`. */
function inFrustum(m: MirrorView, truck: Pose2, p: Vec3): boolean {
  const at = toWorld(truck, m.mount);
  const facing = truck.heading + Math.PI + m.yaw;
  const [cf, sf] = [Math.cos(facing), Math.sin(facing)];
  const [cp, sp] = [Math.cos(m.pitch), Math.sin(m.pitch)];
  const forward = { x: cp * cf, y: cp * sf, z: sp };
  const right0 = { x: sf, y: -cf, z: 0 };
  const up0 = { x: -sp * cf, y: -sp * sf, z: cp };
  const [cr, sr] = [Math.cos(m.roll), Math.sin(m.roll)];
  const d = { x: p.x - at.x, y: p.y - at.y, z: p.z - at.z };
  const dot = (v: Vec3): number => d.x * v.x + d.y * v.y + d.z * v.z;
  const depth = dot(forward);
  if (depth <= 0) return false;
  const [r0, u0] = [dot(right0), dot(up0)];
  const across = cr * r0 + sr * u0;
  const along = -sr * r0 + cr * u0;
  return Math.abs(across) <= depth * m.tanH && Math.abs(along) <= depth * m.tanV;
}

/** How the driver sees world point `p`, past the layout's `occluders` and the combination's own bodies. */
export function pointSight(
  g: SightGeometry,
  s: Bodies,
  p: Vec3,
  occluders: readonly Occluder[],
): Sight {
  const bodies = bodyOccluders(g, s);
  // the eye sits inside the truck's box; the glass test stands in for the cab
  const others = bodies.filter((b) => b.body !== 'truck');
  const direct =
    throughGlass(g.glass, g.eye, toBody(s.truck, p)) &&
    clear(occluders, toWorld(s.truck, g.eye), p) &&
    clear(others, toWorld(s.truck, g.eye), p);
  const mirrors = g.mirrors
    .filter((m) => {
      if (!inFrustum(m, s.truck, p)) return false;
      const at = toWorld(s.truck, m.mount);
      return clear(occluders, at, p) && clear(bodies, at, p);
    })
    .map((m) => m.id);
  return { direct, mirrors };
}

/** Sight of any of `points`: direct if one is seen directly, and every mirror that shows one. */
export function sightOf(
  g: SightGeometry,
  s: Bodies,
  points: readonly Vec3[],
  occluders: readonly Occluder[],
): Sight {
  const each = points.map((p) => pointSight(g, s, p, occluders));
  return {
    direct: each.some((v) => v.direct),
    mirrors: g.mirrors.map((m) => m.id).filter((id) => each.some((v) => v.mirrors.includes(id))),
  };
}
