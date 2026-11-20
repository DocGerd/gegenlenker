import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Box3, Frustum, Matrix4, type Mesh, Object3D, Triangle, Vector3 } from 'three';
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

const readShell = async (id: TruckId, kind: ShellKind) => {
  const bytes = readFileSync(join(import.meta.dirname, `assets/${id}-${kind}.glb`));
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return parseShell(data, kind);
};
const read = async (id: TruckId, kind: ShellKind): Promise<Mesh> =>
  (await readShell(id, kind)).mesh;

const readTrailer = async (id: TrailerId) => {
  const bytes = readFileSync(join(import.meta.dirname, `assets/${id}-trailer.glb`));
  return parseTrailerShell(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
};

/**
 * Share of the body shell's vertices a mirror frames, per truck: about 0.8 of the measured share on
 * both screens. The Arocs' is lower, as its subframe and tailgate add vertices the mirrors do not frame.
 */
const BODY_FLOOR: Record<TruckId, number> = {
  'man-le-18-280': 0.37,
  'arocs-1835-ak': 0.15,
};

const STRAIGHT: Pose2 = { x: 0, y: 0, heading: 0 };
const SCREENS = {
  landscape: [1350, 600],
  portrait: [600, 1350],
} as const;

/** The frusta of both mirrors of truck `id` on `screen`, placed as the renderer does, on the straight pose. */
function mirrorFrusta(id: TruckId, screen: readonly [number, number]) {
  const anchors = truckAnchors(truckById(id));
  const views = computeViewports(screen[0], screen[1], 'drive', null, NO_INSETS);
  const frustum = (side: 'mirrorLeft' | 'mirrorRight'): Frustum => {
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
    return new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(
        mirror.camera.projectionMatrix,
        mirror.camera.matrixWorldInverse,
      ),
    );
  };
  return { left: frustum('mirrorLeft'), right: frustum('mirrorRight') };
}

/** World-space triangles of a shell mesh that stands at `place`. */
function worldTriangles(mesh: Mesh, place: Pose2): [Vector3, Vector3, Vector3][] {
  const placed = new Object3D();
  placePose(placed, place);
  placed.updateMatrixWorld(true);
  const positions = mesh.geometry.getAttribute('position');
  const index = mesh.geometry.getIndex();
  const count = (index ? index.count : positions.count) / 3;
  const corner = (i: number): Vector3 =>
    new Vector3()
      .fromBufferAttribute(positions, index ? index.getX(i) : i)
      .applyMatrix4(mesh.matrixWorld)
      .applyMatrix4(placed.matrixWorld);
  return Array.from({ length: count }, (_, t) => [
    corner(3 * t),
    corner(3 * t + 1),
    corner(3 * t + 2),
  ]);
}

/** Shell vertices inside each mirror's frustum, truck at the straight pose, mirrors placed as the renderer does. */
function verticesInMirrors(mesh: Mesh, id: TruckId, screen: readonly [number, number]) {
  const frusta = mirrorFrusta(id, screen);
  const positions = mesh.geometry.getAttribute('position');
  const world = new Vector3();
  const count = (frustum: Frustum): number => {
    let inside = 0;
    for (let i = 0; i < positions.count; i++) {
      world.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
      if (frustum.containsPoint(world)) inside++;
    }
    return inside;
  };
  return { left: count(frusta.left), right: count(frusta.right), total: positions.count };
}

/** Share of the shell's surface area, by triangle centroid, that each mirror frames. */
function areaInMirrors(mesh: Mesh, id: TruckId, screen: readonly [number, number], place: Pose2) {
  const frusta = mirrorFrusta(id, screen);
  const triangle = new Triangle();
  const centroid = new Vector3();
  const share = { left: 0, right: 0 };
  let total = 0;
  for (const [a, b, c] of worldTriangles(mesh, place)) {
    triangle.set(a, b, c);
    const area = triangle.getArea();
    triangle.getMidpoint(centroid);
    total += area;
    if (frusta.left.containsPoint(centroid)) share.left += area;
    if (frusta.right.containsPoint(centroid)) share.right += area;
  }
  return { left: share.left / total, right: share.right / total };
}

describe.each(TRUCK_IDS)('mirror frustums on the straight pose: %s', (id) => {
  describe.each(Object.entries(SCREENS))('%s screen', (_name, screen) => {
    it('frame the body shell in both mirrors', async () => {
      const seen = verticesInMirrors(await read(id, 'body'), id, screen);
      expect(seen.left / seen.total).toBeGreaterThan(BODY_FLOOR[id]);
      expect(seen.right / seen.total).toBeGreaterThan(BODY_FLOOR[id]);
    });
  });
});

/** Share of the trailer shell's surface each mirror frames at the straight pose, set well below the measured share of every pairing. */
const TRAILER_FLOOR = 0.1;
/** Share of the trailer shell's surface the two mirrors frame together while it is articulated. */
const ARTICULATED_FLOOR = 0.4;
/** The dolly sits low and far back; its floor is for the mirror on the side the drawbar swings to. */
const DOLLY_FLOOR = 0.2;
const COUPLING_ANGLE = (25 * Math.PI) / 180;
const LANDSCAPE = SCREENS.landscape;

const poses = (truck: TruckId, trailer: TrailerId, state: KinematicState) =>
  joints(resolveCombination(truckById(truck), trailerById(trailer)), state);

/** th0 - th1 = 25°: the drawbar and the trailer swing away from the truck's heading to one side. */
const articulated = (sign: number): KinematicState => ({
  x: 0,
  y: 0,
  th0: 0,
  th1: -sign * COUPLING_ANGLE,
  th2: (-sign * COUPLING_ANGLE) / 2,
});

describe.each(TRUCK_IDS.flatMap((t) => TRAILER_IDS.map((r) => [t, r] as const)))(
  'mirror frustums on the trailer shell: %s with %s',
  (truck, trailer) => {
    it('frame the trailer shell at the straight pose', async () => {
      const { trailer: shell } = await readTrailer(trailer);
      const at = poses(truck, trailer, { x: 0, y: 0, th0: 0, th1: 0, th2: 0 });
      const seen = areaInMirrors(shell.mesh, truck, LANDSCAPE, at.trailer);
      expect(seen.left).toBeGreaterThan(TRAILER_FLOOR);
      expect(seen.right).toBeGreaterThan(TRAILER_FLOOR);
    });

    it.each([-1, 1])('frame the trailer shell when articulated (%i)', async (sign) => {
      const { trailer: shell } = await readTrailer(trailer);
      const at = poses(truck, trailer, articulated(sign));
      const seen = areaInMirrors(shell.mesh, truck, LANDSCAPE, at.trailer);
      expect(seen.left + seen.right).toBeGreaterThan(ARTICULATED_FLOOR);
    });

    it.each([-1, 1])('frame the dolly at a coupling angle of 25° (%i)', async (sign) => {
      const { dolly } = await readTrailer(trailer);
      const at = poses(truck, trailer, articulated(sign));
      const seen = areaInMirrors(dolly.mesh, truck, LANDSCAPE, at.dolly);
      expect(sign < 0 ? seen.right : seen.left).toBeGreaterThan(DOLLY_FLOOR);
    });
  },
);

describe.each(TRUCK_IDS)('chase camera on the cab shell: %s', (id) => {
  it.each(Object.entries(SCREENS))(
    'frames the cab front corners of the glb bounds at the default azimuth, %s screen',
    async (_name, screen) => {
      const { mesh, glass } = await readShell(id, 'cab');
      const face = cabFront(truckById(id));
      // The glb's front face: what sits above the frame within the front 0.2 m, which leaves out the
      // tow coupling, the bumper and the roof fittings further back.
      const box = new Box3();
      const point = new Vector3();
      // the windscreen is a mesh of its own
      for (const part of [mesh, ...(glass === null ? [] : [glass])]) {
        const positions = part.geometry.getAttribute('position');
        for (let i = 0; i < positions.count; i++) {
          point.fromBufferAttribute(positions, i).applyMatrix4(part.matrixWorld);
          if (point.y >= face.bottom - 1e-3 && point.x >= face.x - 0.2) box.expandByPoint(point);
        }
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
