import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Box3,
  DoubleSide,
  Frustum,
  Matrix4,
  type Mesh,
  Object3D,
  Raycaster,
  Triangle,
  Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TOP_DOWN_VIEW } from '../contracts/render';
import type { Pose2, Vec2 } from '../contracts/sim';
import { TRAILER_IDS, TRUCK_IDS, type TrailerId, type TruckId } from '../contracts/vehicle';
import { joints, type KinematicState } from '../sim/kinematics';
import { truckAnchors } from '../vehicles/anchors';
import { trailerById, truckById } from '../vehicles/registry';
import { resolveCombination } from '../vehicles/resolve';
import { RELIEF } from './cab-dims';
import {
  cabFront,
  combinationExtent,
  createChaseCamera,
  placeChaseCamera,
  vehicleCentre,
} from './chase-camera';
import { placePose } from './coords';
import { parseShell, parseTrailerShell, type ShellKind } from './glb-shells';
import {
  CLASS_II_LEFT,
  CLASS_II_RIGHT,
  CLASS_IV_LEFT,
  CLASS_IV_RIGHT,
  createMirror,
  mirrorAnchor,
  mirrorMounts,
  mirrorPose,
} from './mirror';
import { classIVField, insidePolygon } from './mirror-fields';
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
 * Share of the body shell's surface a mirror frames, per truck: about 0.8 of the lower measured share
 * on both screens. By area, so detail that adds vertices without surface does not move it. The Arocs'
 * is lower, as more of the tipper's surface lies outside the mirrors' frusta.
 */
const BODY_FLOOR: Record<TruckId, number> = {
  'man-le-18-280': 0.12,
  'arocs-1835-ak': 0.045,
};

const STRAIGHT: Pose2 = { x: 0, y: 0, heading: 0 };
const SCREENS = {
  landscape: [1350, 600],
  portrait: [600, 1350],
} as const;

/** The frusta of both mirrors of truck `id` on `screen`, placed as the renderer does, on the straight pose. */
function mirrorFrusta(id: TruckId, screen: readonly [number, number]) {
  const anchors = truckAnchors(truckById(id));
  const views = computeViewports(screen[0], screen[1], { mode: 'drive', insets: NO_INSETS });
  const frustum = (side: 'mirrorLeft' | 'mirrorRight'): Frustum => {
    const rect = views[side];
    if (rect === null) throw new Error(`no ${side} rectangle`);
    const mirror = createMirror();
    const position = new Vector3();
    const facing = mirrorPose(
      STRAIGHT,
      anchors[side],
      side === 'mirrorLeft' ? 'left' : 'right',
      id,
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
      const seen = areaInMirrors(await read(id, 'body'), id, screen, STRAIGHT);
      expect(seen.left).toBeGreaterThan(BODY_FLOOR[id]);
      expect(seen.right).toBeGreaterThan(BODY_FLOOR[id]);
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
      // The glb's front face: what sits above the frame within the front 0.2 m, neither ahead of it
      // nor outside the side walls, which leaves out the tow coupling, the bumper, the roof fittings
      // further back and the mirror heads.
      const box = new Box3();
      const point = new Vector3();
      // the windscreen is a mesh of its own
      for (const part of [mesh, ...(glass === null ? [] : [glass])]) {
        const positions = part.geometry.getAttribute('position');
        for (let i = 0; i < positions.count; i++) {
          point.fromBufferAttribute(positions, i).applyMatrix4(part.matrixWorld);
          if (
            point.y >= face.bottom - 1e-3 &&
            point.x >= face.x - 0.2 &&
            point.x <= face.x + RELIEF + 1e-3 &&
            Math.abs(point.z) <= face.halfWidth + RELIEF + 1e-3
          ) {
            box.expandByPoint(point);
          }
        }
      }
      expect(box.max.x).toBeCloseTo(face.x + RELIEF, 3);
      expect(box.max.y).toBeCloseTo(face.top, 3);
      expect(box.max.z).toBeCloseTo(face.halfWidth + RELIEF, 3);
      const { topDown } = computeViewports(screen[0], screen[1], {
        mode: 'drive',
        insets: NO_INSETS,
      });
      const camera = createChaseCamera();
      const trailerId = TRAILER_IDS[0] as TrailerId;
      const straight = poses(id, trailerId, { x: 0, y: 0, th0: 0, th1: 0, th2: 0 });
      placeChaseCamera(
        camera,
        {
          truck: STRAIGHT,
          centre: vehicleCentre(straight, face.x),
          extent: combinationExtent(truckById(id), trailerById(trailerId)),
          face,
          colliders: [],
        },
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

/** Where the class II field below is taken to end: the horizon. */
const HORIZON = 60;

/** UN R46 15.2.4.2: class II shows a strip 1 m wide from 4 m behind the ocular points, 5 m wide from 30 m. */
function classIIField(id: TruckId, side: 'left' | 'right'): readonly Vec2[] {
  const { eye } = truckAnchors(truckById(id));
  const sign = side === 'left' ? 1 : -1;
  const half = truckById(id).width.value / 2000;
  const edge = (behind: number, out: number): Vec2 => ({
    x: eye.x - behind,
    y: sign * (half + out),
  });
  return [edge(4, 0), edge(4, 1), edge(30, 1), edge(30, 5), edge(HORIZON, 5), edge(HORIZON, 0)];
}

/** Ground samples of `polygon` on a `step` m grid, and its corners. */
function sampleGround(polygon: readonly Vec2[], step: number): Vec2[] {
  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  const points: Vec2[] = [];
  for (let x = Math.min(...xs); x <= Math.max(...xs) + 1e-9; x += step) {
    for (let y = Math.min(...ys); y <= Math.max(...ys) + 1e-9; y += step) {
      if (insidePolygon(polygon, { x, y })) points.push({ x, y });
    }
  }
  return [...points, ...polygon];
}

/** Share of the half-frame, in normalised device coordinates, that the class II field keeps clear of each frame edge. */
const FIELD_MARGIN = 0.1;

/** The narrowest and the widest class II rect, width over height, of drive and mirror-only screens. */
function classIIAspects(): readonly [number, number] {
  let narrowest = Infinity;
  let widest = 0;
  for (const mode of ['drive', 'mirrors'] as const) {
    for (let w = 640; w <= 2560; w += 80) {
      for (let h = 360; h <= 1440; h += 60) {
        const rect = computeViewports(w, h, { mode, insets: NO_INSETS }).mirrorLeft;
        if (rect === null) continue;
        narrowest = Math.min(narrowest, rect.width / rect.height);
        widest = Math.max(widest, rect.width / rect.height);
      }
    }
  }
  return [narrowest, widest];
}

describe.each(TRUCK_IDS)('class II aim: %s', (id) => {
  it.each(['left', 'right'] as const)(
    'frames the whole R46 field on the %s side at every class II aspect',
    (side) => {
      const key = side === 'left' ? 'mirrorLeft' : 'mirrorRight';
      for (const aspect of classIIAspects()) {
        const mirror = createMirror();
        const position = new Vector3();
        mirror.place(
          position,
          mirrorPose(STRAIGHT, truckAnchors(truckById(id))[key], side, id, position),
        );
        mirror.camera.aspect = aspect;
        mirror.camera.updateProjectionMatrix();
        mirror.camera.updateMatrixWorld(true);
        // the field is a ground polygon and the frustum convex: its corners suffice
        for (const p of classIIField(id, side)) {
          const ndc = new Vector3(p.x, 0, -p.y).project(mirror.camera);
          const at = `${aspect.toFixed(2)}: ${p.x.toFixed(2)}, ${p.y.toFixed(2)}`;
          expect(Math.abs(ndc.x), at).toBeLessThan(1 - FIELD_MARGIN);
          expect(Math.abs(ndc.y), at).toBeLessThan(1 - FIELD_MARGIN);
          expect(ndc.z, at).toBeLessThan(1);
        }
      }
    },
  );
});

// The class V and VI fields are checked against the cab in close-mirror.test.ts and front-mirror.test.ts.
describe.each(TRUCK_IDS)('the cab and its mirror heads on the class II and IV fields: %s', (id) => {
  const truck = truckById(id);
  const mirrors = [
    { spec: CLASS_II_LEFT, field: classIIField(id, 'left') },
    { spec: CLASS_II_RIGHT, field: classIIField(id, 'right') },
    { spec: CLASS_IV_LEFT, field: classIVField(truck, 'left') },
    { spec: CLASS_IV_RIGHT, field: classIVField(truck, 'right') },
  ];

  it.each(mirrors.map((m) => [m.spec.anchor, m] as const))(
    'hide none of the %s field from its camera',
    async (_anchor, { spec, field }) => {
      const mesh = await read(id, 'cab');
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => {
        m.side = DoubleSide;
      });
      mesh.updateMatrixWorld(true);
      const mount = mirrorAnchor(spec, mirrorMounts(truck));
      const camera = new Vector3(mount.x, mount.z, -mount.y);
      const raycaster = new Raycaster();
      const blocked = (p: Vec2): boolean => {
        const toTarget = new Vector3(p.x, 0, -p.y).sub(camera);
        raycaster.set(camera, toTarget.clone().normalize());
        raycaster.far = toTarget.length() - 1e-3;
        return raycaster.intersectObject(mesh, false).length > 0;
      };
      // control: the cab hides the ground beyond its far side from the same camera
      expect(blocked({ x: mount.x, y: -Math.sign(mount.y) * 0.5 })).toBe(true);
      const points = sampleGround(field, 0.5);
      expect(points.length).toBeGreaterThan(100);
      expect(points.filter(blocked)).toEqual([]);
    },
  );
});
