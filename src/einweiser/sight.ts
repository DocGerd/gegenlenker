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
  // a segment wholly above the box, or farther from its centre than its corners, cannot pass through it
  if (Math.min(a.z, b.z) >= o.height) return false;
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const length2 = dx * dx + dy * dy;
  const along = length2 === 0 ? 0 : ((cx - a.x) * dx + (cy - a.y) * dy) / length2;
  const reach = Math.min(1, Math.max(0, along));
  const [ex, ey] = [a.x + reach * dx - cx, a.y + reach * dy - cy];
  if (ex * ex + ey * ey > halfLength * halfLength + halfWidth * halfWidth + 1e-4) return false;
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

/** A mirror's frame on a truck at a pose, fixed for every point asked of it. */
type MirrorFrame = {
  readonly id: MirrorId;
  readonly at: Vec3;
  readonly forward: Vec3;
  readonly right0: Vec3;
  readonly up0: Vec3;
  readonly cr: number;
  readonly sr: number;
  readonly tanV: number;
  readonly tanH: number;
};

function mirrorFrame(m: MirrorView, truck: Pose2): MirrorFrame {
  const facing = truck.heading + Math.PI + m.yaw;
  const [cf, sf] = [Math.cos(facing), Math.sin(facing)];
  const [cp, sp] = [Math.cos(m.pitch), Math.sin(m.pitch)];
  return {
    id: m.id,
    at: toWorld(truck, m.mount),
    forward: { x: cp * cf, y: cp * sf, z: sp },
    right0: { x: sf, y: -cf, z: 0 },
    up0: { x: -sp * cf, y: -sp * sf, z: cp },
    cr: Math.cos(m.roll),
    sr: Math.sin(m.roll),
    tanV: m.tanV,
    tanH: m.tanH,
  };
}

/** Whether mirror `m` frames world point `p`. */
function inFrustum(m: MirrorFrame, p: Vec3): boolean {
  const d = { x: p.x - m.at.x, y: p.y - m.at.y, z: p.z - m.at.z };
  const dot = (v: Vec3): number => d.x * v.x + d.y * v.y + d.z * v.z;
  const depth = dot(m.forward);
  if (depth <= 0) return false;
  const [r0, u0] = [dot(m.right0), dot(m.up0)];
  const across = m.cr * r0 + m.sr * u0;
  const along = -m.sr * r0 + m.cr * u0;
  return Math.abs(across) <= depth * m.tanH && Math.abs(along) <= depth * m.tanV;
}

/** How the driver sees points, past the layout's `occluders` and the combination's own bodies: the snapshot's bodies and mirrors are read once for any number of points. */
export function sightField(
  g: SightGeometry,
  s: Bodies,
  occluders: readonly Occluder[],
): {
  readonly point: (p: Vec3) => Sight;
  readonly of: (points: readonly Vec3[]) => Sight;
} {
  const bodies = bodyOccluders(g, s);
  // the eye sits inside the truck's box; the glass test stands in for the cab
  const others = bodies.filter((b) => b.body !== 'truck');
  const eye = toWorld(s.truck, g.eye);
  const frames = g.mirrors.map((m) => mirrorFrame(m, s.truck));
  const point = (p: Vec3): Sight => {
    const direct =
      throughGlass(g.glass, g.eye, toBody(s.truck, p)) &&
      clear(occluders, eye, p) &&
      clear(others, eye, p);
    const mirrors = frames
      .filter((m) => inFrustum(m, p) && clear(occluders, m.at, p) && clear(bodies, m.at, p))
      .map((m) => m.id);
    return { direct, mirrors };
  };
  return {
    point,
    /** Sight of any of `points`: direct if one is seen directly, and every mirror that shows one. */
    of(points) {
      const each = points.map(point);
      return {
        direct: each.some((v) => v.direct),
        mirrors: g.mirrors
          .map((m) => m.id)
          .filter((id) => each.some((v) => v.mirrors.includes(id))),
      };
    },
  };
}

/** How the driver sees world point `p`, past the layout's `occluders` and the combination's own bodies. */
export const pointSight = (
  g: SightGeometry,
  s: Bodies,
  p: Vec3,
  occluders: readonly Occluder[],
): Sight => sightField(g, s, occluders).point(p);

/** Sight of any of `points`: direct if one is seen directly, and every mirror that shows one. */
export const sightOf = (
  g: SightGeometry,
  s: Bodies,
  points: readonly Vec3[],
  occluders: readonly Occluder[],
): Sight => sightField(g, s, occluders).of(points);
