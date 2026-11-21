import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Frustum, Matrix4, type Mesh, Object3D, Ray, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { Pose2 } from '../contracts/sim';
import { TRAILER_IDS, TRUCK_IDS, type TrailerId, type TruckId } from '../contracts/vehicle';
import { joints } from '../sim/kinematics';
import { truckAnchors } from '../vehicles/anchors';
import { trailerById, truckById } from '../vehicles/registry';
import { resolveCombination } from '../vehicles/resolve';
import { bodyToThree, placePose } from './coords';
import { parseShell, parseTrailerShell } from './glb-shells';
import { type Lamp, trailerLamps, truckLamps } from './lamp-layout';
import { TRAILER_LOOKS } from './livery';
import { createMirror, mirrorPose } from './mirror';
import { computeViewports, NO_INSETS } from './viewports';

/*
 * The white halves of the rear stalk lamps (R48 6.13.2(a)) must show in the main mirrors (6.13.9):
 * the real mirror cameras on the straight pose, on both screen shapes, with the real shell meshes
 * as occluders.
 */

const STRAIGHT: Pose2 = { x: 0, y: 0, heading: 0 };
const SCREENS = { landscape: [1350, 600], portrait: [600, 1350] } as const;
/** The line of sight stops this far short of the lens centre, which sits on its face. */
const STOP_SHORT = 0.01;

const isRearView = (l: Lamp): boolean => l.id.startsWith('end-outline-view-');
const centre = ([a, b]: readonly [number, number]): number => (a + b) / 2;
const bytes = (key: string): ArrayBuffer => {
  const file = readFileSync(join(import.meta.dirname, `assets/${key}.glb`));
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
};

/** A mesh with the pose it stands at. */
type Occluder = { readonly mesh: Mesh; readonly pose: Pose2 };

function mirrorOf(id: TruckId, screen: readonly [number, number], side: 'left' | 'right') {
  const key = side === 'left' ? 'mirrorLeft' : 'mirrorRight';
  const rect = computeViewports(screen[0], screen[1], 'drive', null, NO_INSETS)[key];
  if (rect === null) throw new Error(`no ${side} rectangle`);
  const mirror = createMirror();
  const position = new Vector3();
  mirror.place(position, mirrorPose(STRAIGHT, truckAnchors(truckById(id))[key], side, position));
  mirror.camera.aspect = rect.width / rect.height;
  mirror.camera.updateProjectionMatrix();
  mirror.camera.updateMatrixWorld(true);
  const frustum = new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(
      mirror.camera.projectionMatrix,
      mirror.camera.matrixWorldInverse,
    ),
  );
  return { frustum, position };
}

/** Whether the mesh, at its pose, crosses the segment from `from` to `to`. */
function blocks({ mesh, pose }: Occluder, from: Vector3, to: Vector3): boolean {
  const placed = new Object3D();
  placePose(placed, pose);
  placed.updateMatrixWorld(true);
  const world = new Matrix4().multiplyMatrices(placed.matrixWorld, mesh.matrixWorld);
  const positions = mesh.geometry.getAttribute('position');
  const index = mesh.geometry.getIndex();
  const count = (index ? index.count : positions.count) / 3;
  const corner = (i: number, out: Vector3): Vector3 =>
    out.fromBufferAttribute(positions, index ? index.getX(i) : i).applyMatrix4(world);
  const direction = to.clone().sub(from);
  const length = direction.length() - STOP_SHORT;
  const ray = new Ray(from, direction.normalize());
  const [a, b, c, hit] = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
  for (let t = 0; t < count; t++) {
    const at = ray.intersectTriangle(
      corner(3 * t, a),
      corner(3 * t + 1, b),
      corner(3 * t + 2, c),
      false,
      hit,
    );
    if (at !== null && at.distanceTo(from) < length) return true;
  }
  return false;
}

type Case = {
  readonly name: string;
  readonly truck: TruckId;
  readonly lamps: readonly Lamp[];
  readonly pose: Pose2;
  readonly occluders: () => Promise<Occluder[]>;
};

const bodyOf = async (truck: TruckId): Promise<Occluder> => ({
  mesh: (await parseShell(bytes(`${truck}-body`), 'body')).mesh,
  pose: STRAIGHT,
});

function cases(): Case[] {
  return TRUCK_IDS.flatMap((truck) => {
    const spec = truckById(truck);
    const own: Case = {
      name: `${truck} body`,
      truck,
      lamps: truckLamps(spec).lamps.filter(isRearView),
      pose: STRAIGHT,
      occluders: async () => [await bodyOf(truck)],
    };
    const trailers = TRAILER_IDS.map((id: TrailerId): Case => {
      const at = joints(resolveCombination(spec, trailerById(id)), {
        x: 0,
        y: 0,
        th0: 0,
        th1: 0,
        th2: 0,
      });
      const pose = { x: at.trailer.x, y: at.trailer.y, heading: at.trailer.heading };
      return {
        name: `${truck} towing ${id} (${TRAILER_LOOKS[id].kind})`,
        truck,
        lamps: trailerLamps(trailerById(id), 'shell').lamps.filter(isRearView),
        pose,
        occluders: async () => [
          await bodyOf(truck),
          { mesh: (await parseTrailerShell(bytes(`${id}-trailer`))).trailer.mesh, pose },
        ],
      };
    });
    return [own, ...trailers];
  });
}

describe.each(cases())('rear stalk lamps of $name', (c) => {
  describe.each(Object.entries(SCREENS))('on a %s screen', (_screen, size) => {
    it.each(c.lamps.map((l) => [l.id, l] as const))(
      'show %s in its own side mirror',
      async (_id, l) => {
        const { frustum, position } = mirrorOf(c.truck, size, l.side > 0 ? 'left' : 'right');
        const spot = bodyToThree(c.pose, {
          x: centre(l.box[0]),
          y: centre(l.box[1]),
          z: centre(l.box[2]),
        });
        expect(frustum.containsPoint(spot), 'inside the mirror frustum').toBe(true);
        // the lens faces forward, so the mirror, ahead of it, sees its face
        expect(position.x, 'mirror ahead of the lens face').toBeGreaterThan(l.box[0][1] + c.pose.x);
        for (const occluder of await c.occluders()) {
          expect(blocks(occluder, position, spot), 'a body hides the lens').toBe(false);
        }
      },
    );
  });
});
