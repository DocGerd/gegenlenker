import { Frustum, Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { Pose2 } from '../contracts/sim';
import { TRAILER_IDS, TRUCK_IDS, type TrailerId, type TruckId } from '../contracts/vehicle';
import { joints } from '../sim/kinematics';
import { trailerAnchors, truckAnchors } from '../vehicles/anchors';
import { trailerById, truckById } from '../vehicles/registry';
import { resolveCombination } from '../vehicles/resolve';
import { bodyToThree } from './coords';
import { type Lamp, trailerLamps, truckLamps } from './lamp-layout';
import { createMirror, mirrorPose } from './mirror';
import { computeViewports, NO_INSETS } from './viewports';

/*
 * The white halves of the rear stalk lamps (R48 6.13.2(a)) must show in the main mirrors (6.13.9):
 * the real mirror cameras on the straight pose, on both screen shapes.
 */

const STRAIGHT: Pose2 = { x: 0, y: 0, heading: 0 };
const SCREENS = { landscape: [1350, 600], portrait: [600, 1350] } as const;

const isRearView = (l: Lamp): boolean => l.id.startsWith('end-outline-view-');
const centre = ([a, b]: readonly [number, number]): number => (a + b) / 2;

/** The frustum of one mirror of truck `id`, placed as the renderer does, and the mirror's body-frame position. */
function mirrorOf(id: TruckId, screen: readonly [number, number], side: 'left' | 'right') {
  const anchor = truckAnchors(truckById(id))[side === 'left' ? 'mirrorLeft' : 'mirrorRight'];
  const rect = computeViewports(screen[0], screen[1], 'drive', null, NO_INSETS)[
    side === 'left' ? 'mirrorLeft' : 'mirrorRight'
  ];
  if (rect === null) throw new Error(`no ${side} rectangle`);
  const mirror = createMirror();
  const position = new Vector3();
  mirror.place(position, mirrorPose(STRAIGHT, anchor, side, position));
  mirror.camera.aspect = rect.width / rect.height;
  mirror.camera.updateProjectionMatrix();
  mirror.camera.updateMatrixWorld(true);
  const frustum = new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(
      mirror.camera.projectionMatrix,
      mirror.camera.matrixWorldInverse,
    ),
  );
  return { frustum, anchor };
}

/** Whether the segment `a` to `b` crosses the axis-aligned box (slab test, sim frame). */
function crosses(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  min: readonly [number, number, number],
  max: readonly [number, number, number],
): boolean {
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 3; i++) {
    const from = a[i] as number;
    const d = (b[i] as number) - from;
    const lo = min[i] as number;
    const hi = max[i] as number;
    if (Math.abs(d) < 1e-12) {
      if (from < lo || from > hi) return false;
      continue;
    }
    const [u, w] = [(lo - from) / d, (hi - from) / d];
    t0 = Math.max(t0, Math.min(u, w));
    t1 = Math.min(t1, Math.max(u, w));
    if (t0 > t1) return false;
  }
  return true;
}

type Case = {
  readonly name: string;
  readonly truck: TruckId;
  readonly lamps: readonly Lamp[];
  readonly pose: Pose2;
  /** The part's rear and front in its own frame, and its half width. */
  readonly rear: number;
  readonly front: number;
  readonly halfWidth: number;
};

function cases(): Case[] {
  return TRUCK_IDS.flatMap((truck) => {
    const spec = truckById(truck);
    const a = truckAnchors(spec);
    const own: Case = {
      name: `${truck} body`,
      truck,
      lamps: truckLamps(spec).lamps.filter((l) => isRearView(l)),
      pose: STRAIGHT,
      rear: a.rearX,
      front: a.frontX,
      halfWidth: spec.width.value / 2000,
    };
    const trailers = TRAILER_IDS.flatMap((id: TrailerId) => {
      const t = trailerById(id);
      const ta = trailerAnchors(t);
      const at = joints(resolveCombination(spec, t), { x: 0, y: 0, th0: 0, th1: 0, th2: 0 });
      return (['procedural', 'shell'] as const).map((variant): Case => ({
        name: `${truck} towing ${id} (${variant})`,
        truck,
        lamps: trailerLamps(t, variant).lamps.filter(isRearView),
        pose: { x: at.trailer.x, y: at.trailer.y, heading: at.trailer.heading },
        rear: ta.rearX,
        front: ta.turntable.x + ta.eye.x,
        halfWidth: t.width.value / 2000,
      }));
    });
    return [own, ...trailers];
  });
}

describe.each(cases())('rear stalk lamps of $name', (c) => {
  describe.each(Object.entries(SCREENS))('on a %s screen', (_screen, size) => {
    it.each(c.lamps.map((l) => [l.id, l] as const))('show %s in its own side mirror', (_id, l) => {
      const { frustum, anchor } = mirrorOf(c.truck, size, l.side > 0 ? 'left' : 'right');
      const spot = {
        x: centre(l.box[0]),
        y: centre(l.box[1]),
        z: centre(l.box[2]),
      };
      expect(frustum.containsPoint(bodyToThree(c.pose, spot)), 'inside the mirror frustum').toBe(
        true,
      );
      // the lens faces forward, so the mirror, ahead of it, sees its face
      expect(anchor.x, 'mirror ahead of the lens face').toBeGreaterThan(l.box[0][1] + c.pose.x);
      // the line of sight clears the part's own volume
      const from: [number, number, number] = [anchor.x, anchor.y, anchor.z];
      const to: [number, number, number] = [spot.x + c.pose.x, spot.y + c.pose.y, spot.z];
      const hidden = crosses(
        from,
        to,
        [c.rear + c.pose.x, -c.halfWidth, 0],
        [c.front + c.pose.x, c.halfWidth, spot.z - 0.005],
      );
      expect(hidden, 'the part hides the lens').toBe(false);
    });
  });
});
