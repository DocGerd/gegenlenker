import { describe, expect, it } from 'vitest';
import { layouts } from '../content/registry';
import { resolveLayout } from '../content/resolve-layout';
import type { MirrorId, TrailerSpec, TruckSpec, Vec3 } from '../contracts/vehicle';
import type { Pose2, SimSnapshot } from '../contracts/sim';
import { bodyFootprints } from '../sim/geometry';
import { createSimulation } from '../sim/simulation';
import { truckAnchors } from '../vehicles/anchors';
import { cabGlass } from '../vehicles/cab';
import { mirrorMounts } from '../vehicles/mirrors';
import { trailers, trucks } from '../vehicles/registry';
import { bodyPoints, layoutOccluders, sightGeometry, sightOf } from './sight';

const pairs = trucks.flatMap((truck) => trailers.map((trailer) => ({ truck, trailer })));
const ORIGIN: Pose2 = { x: 0, y: 0, heading: 0 };

const combination = (truck: TruckSpec, trailer: TrailerSpec, start = {}, at = ORIGIN) =>
  createSimulation(
    sightGeometry(truck, trailer).params,
    { truck: at, ...start },
    () => null,
  ).snapshot();

const world = (pose: Pose2, p: Vec3): Vec3 => {
  const [c, s] = [Math.cos(pose.heading), Math.sin(pose.heading)];
  return { x: pose.x + c * p.x - s * p.y, y: pose.y + s * p.x + c * p.y, z: p.z };
};

const trailerBody = (s: SimSnapshot, truck: TruckSpec, trailer: TrailerSpec) => {
  const footprint = bodyFootprints(sightGeometry(truck, trailer).params, s)[2];
  if (footprint?.body !== 'trailer') throw new Error('no trailer footprint');
  return footprint.obb;
};

describe.each(pairs)('sight for $truck.id with $trailer.id', ({ truck, trailer }) => {
  const g = sightGeometry(truck, trailer);
  const straight = combination(truck, trailer);

  it('sees the rear left corner in the left class II', () => {
    const body = trailerBody(straight, truck, trailer);
    const rear = body.cx - body.halfLength;
    const sight = sightOf(g, straight, bodyPoints({ x: rear + 1, y: body.halfWidth + 1 }), []);
    expect(sight.mirrors).toContain('mirrorLeft');
  });

  it('does not see him straight behind the trailer', () => {
    const body = trailerBody(straight, truck, trailer);
    const point = { x: body.cx - body.halfLength - 3, y: 0 };
    expect(sightOf(g, straight, bodyPoints(point), [])).toEqual({ direct: false, mirrors: [] });
  });

  it('sees him directly beside the cab', () => {
    const { sideFront, half } = cabGlass(truck);
    expect(sightOf(g, straight, bodyPoints({ x: sideFront, y: half + 1 }), []).direct).toBe(true);
  });

  it('loses him behind a swap body on the plot', () => {
    const decor = resolveLayout(layouts.depot, null).decor.filter((d) => d.asset === 'swap-body');
    const [swap] = decor;
    if (swap === undefined) throw new Error('the depot plot has no swap body');
    const { cx, cy, halfWidth } = swap.footprint;
    const { frontX, eye } = truckAnchors(truck);
    // heading north at the body's x, the eye on its long axis, 8 m short of its south face
    const at = { x: cx + eye.y, y: cy - halfWidth - 8 - frontX, heading: Math.PI / 2 };
    const s = combination(truck, trailer, {}, at);
    const points = bodyPoints({ x: cx, y: cy + halfWidth + 2 });
    expect(sightOf(g, s, points, []).direct).toBe(true);
    expect(sightOf(g, s, points, layoutOccluders({ obstacles: [], decor: [swap] })).direct).toBe(
      false,
    );
  });
});

describe.each(pairs.filter(({ trailer }) => trailer.body === 'box'))(
  'sight past the $trailer.id body behind $truck.id',
  ({ truck, trailer }) => {
    const g = sightGeometry(truck, trailer);
    // the truck turned right of the drawbar swings the trailer out to the left
    const s = combination(truck, trailer, { couplingAngle: 0.5, turntableAngle: 0.3 });
    const mirror = world(s.truck, mirrorMounts(truck).mirrorLeft);
    const body = trailerBody(s, truck, trailer);
    // beyond the body, on the line from the left class II through its centre
    const point = {
      x: mirror.x + 1.6 * (body.cx - mirror.x),
      y: mirror.y + 1.6 * (body.cy - mirror.y),
    };
    const flat = { ...g, heights: { ...g.heights, trailer: 0 } };

    it('frames him in the left class II without the body', () => {
      expect(sightOf(flat, s, bodyPoints(point), []).mirrors).toContain('mirrorLeft');
    });

    it('hides him behind the articulated body', () => {
      expect(sightOf(g, s, bodyPoints(point), []).mirrors).not.toContain('mirrorLeft');
    });
  },
);

describe.each(trucks)('mirror mounts of $id', (truck) => {
  const mounts = mirrorMounts(truck);
  const ids = Object.keys(mounts) as MirrorId[];
  const glass = cabGlass(truck);
  const { eye } = truckAnchors(truck);

  // where the eye's line to the mount leaves the cab box, in the window band and off the A-pillar strip
  it.each(ids)('%s: the eye sees it clear of the A-pillars', (id) => {
    const p = mounts[id];
    const side = Math.sign(p.y);
    const front = p.x > glass.frontX ? (glass.frontX - eye.x) / (p.x - eye.x) : Infinity;
    const lateral =
      Math.abs(p.y) > glass.half ? (side * glass.half - eye.y) / (p.y - eye.y) : Infinity;
    const t = Math.min(front, lateral);
    const at = (from: number, to: number): number => from + t * (to - from);
    const [x, y, z] = [at(eye.x, p.x), at(eye.y, p.y), at(eye.z, p.z)];
    const onPillar = t === front ? Math.abs(y) > glass.screen : x > glass.sideFront;
    expect(onPillar).toBe(false);
    expect(z).toBeGreaterThanOrEqual(glass.sill);
    expect(z).toBeLessThanOrEqual(glass.top);
  });

  it.each(ids)('%s: sits outside the cab, so the truck box never hides it', (id) => {
    const { x, y } = mounts[id];
    expect(x > glass.frontX || Math.abs(y) > glass.half).toBe(true);
  });
});
