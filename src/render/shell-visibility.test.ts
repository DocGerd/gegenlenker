import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Box3, Frustum, Matrix4, type Mesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TOP_DOWN_VIEW } from '../contracts/render';
import type { Pose2 } from '../contracts/sim';
import { TRUCK_IDS, type TruckId } from '../contracts/vehicle';
import { truckAnchors } from '../vehicles/anchors';
import { truckById } from '../vehicles/registry';
import { RELIEF } from './cab-dims';
import { cabFront, createChaseCamera, placeChaseCamera } from './chase-camera';
import { bodyToThree } from './coords';
import { parseShell } from './glb-shells';
import { createMirror, MIRROR_YAW } from './mirror';
import { computeViewports, NO_INSETS } from './viewports';

/*
 * The shells are only worth their bytes if a camera frames them. These tests place the real mirror
 * cameras on the straight pose, with the mirror rectangles of landscape and portrait screens, and
 * count the shell vertices inside each frustum.
 */

const read = async (id: TruckId, kind: 'cab' | 'body'): Promise<Mesh> => {
  const bytes = readFileSync(join(import.meta.dirname, `assets/${id}-${kind}.glb`));
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return (await parseShell(data)).mesh;
};

const STRAIGHT: Pose2 = { x: 0, y: 0, heading: 0 };
const SCREENS = {
  landscape: [1350, 600],
  portrait: [600, 1350],
} as const;

/** Shell vertices inside each mirror's frustum, truck at the straight pose, mirrors placed as the renderer does. */
function verticesInMirrors(mesh: Mesh, id: TruckId, screen: readonly [number, number]) {
  const anchors = truckAnchors(truckById(id));
  const views = computeViewports(screen[0], screen[1], 'drive', null, NO_INSETS);
  const positions = mesh.geometry.getAttribute('position');
  const world = new Vector3();
  const count = (side: 'mirrorLeft' | 'mirrorRight'): number => {
    const rect = views[side];
    if (rect === null) throw new Error(`no ${side} rectangle`);
    const mirror = createMirror();
    const sign = side === 'mirrorLeft' ? -1 : 1;
    mirror.place(
      bodyToThree(STRAIGHT, anchors[side], new Vector3()),
      STRAIGHT.heading + Math.PI + sign * MIRROR_YAW,
    );
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
      world.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
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
      expect(seen.left).toBeGreaterThan(0);
      expect(seen.right).toBeGreaterThan(0);
    });

    // Measured: the mirrors sit beside the cab and look back along its side, so they frame at most
    // the cab's rear edge. The cab livery shows only in a camera that looks at the cab from outside.
    it('frame next to none of the cab shell', async () => {
      const seen = verticesInMirrors(await read(id, 'cab'), id, screen);
      expect(Math.max(seen.left, seen.right) / seen.total).toBeLessThan(0.05);
    });
  });
});

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
