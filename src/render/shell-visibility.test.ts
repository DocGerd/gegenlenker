import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Box3, Frustum, Matrix4, type Mesh, Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TOP_DOWN_VIEW } from '../contracts/render';
import type { Pose2 } from '../contracts/sim';
import { TRAILER_IDS, TRUCK_IDS, type TrailerId, type TruckId } from '../contracts/vehicle';
import { joints, type KinematicState } from '../sim/kinematics';
import { truckAnchors } from '../vehicles/anchors';
import { trailerById, truckById } from '../vehicles/registry';
import { resolveCombination } from '../vehicles/resolve';
import { RELIEF } from './cab-dims';
import { cabFront, createChaseCamera, placeChaseCamera } from './chase-camera';
import { placePose } from './coords';
import { parseShell, parseTrailerShell, type ShellKind } from './glb-shells';
import { createMirror, mirrorPose } from './mirror';
import { computeViewports, NO_INSETS } from './viewports';

/*
 * The shells are only worth their bytes if a camera frames them. These tests place the real mirror
 * cameras on the straight pose, with the mirror rectangles of landscape and portrait screens, and
 * count the shell vertices inside each frustum.
 */

const read = async (id: TruckId, kind: ShellKind): Promise<Mesh> => {
  const bytes = readFileSync(join(import.meta.dirname, `assets/${id}-${kind}.glb`));
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return (await parseShell(data, kind)).mesh;
};

const readTrailer = async (id: TrailerId) => {
  const bytes = readFileSync(join(import.meta.dirname, `assets/${id}-trailer.glb`));
  return parseTrailerShell(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
};

/** Share of the body shell's vertices a mirror frames: set below the measured share of both trucks on both screens. */
const BODY_FLOOR = 0.3;

const STRAIGHT: Pose2 = { x: 0, y: 0, heading: 0 };
const SCREENS = {
  landscape: [1350, 600],
  portrait: [600, 1350],
} as const;

/** Shell vertices inside each mirror's frustum, truck at the straight pose, mirrors placed as the renderer does. */
function verticesInMirrors(
  mesh: Mesh,
  id: TruckId,
  screen: readonly [number, number],
  place: Pose2 = STRAIGHT,
) {
  const anchors = truckAnchors(truckById(id));
  const placed = new Object3D();
  placePose(placed, place);
  placed.updateMatrixWorld(true);
  const views = computeViewports(screen[0], screen[1], 'drive', null, NO_INSETS);
  const positions = mesh.geometry.getAttribute('position');
  const world = new Vector3();
  const count = (side: 'mirrorLeft' | 'mirrorRight'): number => {
    const rect = views[side];
    if (rect === null) throw new Error(`no ${side} rectangle`);
    const mirror = createMirror();
    const position = new Vector3();
    const facing = mirrorPose(
      STRAIGHT,
      anchors[side],
      side === 'mirrorLeft' ? 'left' : 'right',
      position,
    );
    mirror.place(position, facing);
    mirror.camera.aspect = rect.width / rect.height;
    mirror.camera.updateProjectionMatrix();
    mirror.camera.updateMatrixWorld(true);
    const frustum = new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(
        mirror.camera.projectionMatrix,
        mirror.camera.matrixWorldInverse,
      ),
    );
    let inside = 0;
    for (let i = 0; i < positions.count; i++) {
      world
        .fromBufferAttribute(positions, i)
        .applyMatrix4(mesh.matrixWorld)
        .applyMatrix4(placed.matrixWorld);
      if (frustum.containsPoint(world)) inside++;
    }
    return inside;
  };
  return { left: count('mirrorLeft'), right: count('mirrorRight'), total: positions.count };
}

describe.each(TRUCK_IDS)('mirror frustums on the straight pose: %s', (id) => {
  describe.each(Object.entries(SCREENS))('%s screen', (_name, screen) => {
    it('frame the body shell in both mirrors', async () => {
      const seen = verticesInMirrors(await read(id, 'body'), id, screen);
      expect(seen.left / seen.total).toBeGreaterThan(BODY_FLOOR);
      expect(seen.right / seen.total).toBeGreaterThan(BODY_FLOOR);
    });
  });
});

/** Share of the trailer shell's vertices each mirror frames, set below the measured share of every pairing on both screens. */
const TRAILER_FLOOR = 0.4;
/** The dolly sits low and far back; its floor is for the mirror on the side the drawbar swings to. */
const DOLLY_FLOOR = 0.2;
const COUPLING_ANGLE = (25 * Math.PI) / 180;

const poses = (truck: TruckId, trailer: TrailerId, state: KinematicState) =>
  joints(resolveCombination(truckById(truck), trailerById(trailer)), state);

describe.each(TRUCK_IDS.flatMap((t) => TRAILER_IDS.map((r) => [t, r] as const)))(
  'mirror frustums on the trailer shell: %s with %s',
  (truck, trailer) => {
    describe.each(Object.entries(SCREENS))('%s screen', (_name, screen) => {
      it('frame the trailer shell at the straight pose', async () => {
        const { trailer: shell } = await readTrailer(trailer);
        const at = poses(truck, trailer, { x: 0, y: 0, th0: 0, th1: 0, th2: 0 });
        const seen = verticesInMirrors(shell.mesh, truck, screen, at.trailer);
        expect(seen.left / seen.total).toBeGreaterThan(TRAILER_FLOOR);
        expect(seen.right / seen.total).toBeGreaterThan(TRAILER_FLOOR);
      });

      it.each([-1, 1])('frame the dolly at a coupling angle of 25° (%i)', async (sign) => {
        const { dolly } = await readTrailer(trailer);
        // th0 - th1 = 25°: the drawbar swings away from the truck's heading to one side
        const at = poses(truck, trailer, {
          x: 0,
          y: 0,
          th0: 0,
          th1: -sign * COUPLING_ANGLE,
          th2: (-sign * COUPLING_ANGLE) / 2,
        });
        const seen = verticesInMirrors(dolly.mesh, truck, screen, at.dolly);
        const near = sign < 0 ? seen.right : seen.left;
        expect(near / seen.total).toBeGreaterThan(DOLLY_FLOOR);
      });
    });
  },
);

describe.each(TRUCK_IDS)('chase camera on the cab shell: %s', (id) => {
  it.each(Object.entries(SCREENS))(
    'frames the cab front corners of the glb bounds at the default azimuth, %s screen',
    async (_name, screen) => {
      const mesh = await read(id, 'cab');
      const face = cabFront(truckById(id));
      // The glb's front face: what sits above the frame within the front 0.2 m, which leaves out the
      // tow coupling, the bumper and the roof fittings further back.
      const box = new Box3();
      const positions = mesh.geometry.getAttribute('position');
      const point = new Vector3();
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
        if (point.y >= face.bottom - 1e-3 && point.x >= face.x - 0.2) box.expandByPoint(point);
      }
      expect(box.max.x).toBeCloseTo(face.x + RELIEF, 3);
      expect(box.max.y).toBeCloseTo(face.top, 3);
      expect(box.max.z).toBeCloseTo(face.halfWidth + RELIEF, 3);
      const { topDown } = computeViewports(screen[0], screen[1], 'drive', null, NO_INSETS);
      const camera = createChaseCamera();
      placeChaseCamera(
        camera,
        STRAIGHT,
        cabFront(truckById(id)),
        {
          width: topDown.width,
          height: topDown.height,
          clear: { x: 0, y: 0, width: topDown.width, height: topDown.height },
        },
        DEFAULT_TOP_DOWN_VIEW,
      );
      const frustum = new Frustum().setFromProjectionMatrix(
        new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
      );
      // Three space: the shell's front face is its +x side, its height is y, its width z.
      const corners = [box.min.z, box.max.z].flatMap((z) =>
        [box.min.y, box.max.y].map((y) => new Vector3(box.max.x, y, z)),
      );
      for (const corner of corners) {
        expect(frustum.containsPoint(corner), corner.toArray().join(',')).toBe(true);
      }
    },
  );
});
