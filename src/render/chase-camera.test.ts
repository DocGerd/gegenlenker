import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Box3, Frustum, Layers, Matrix4, Mesh, Vector3, type PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { exercises, layouts } from '../content/registry';
import { KIT_FOOTPRINTS } from '../content/kit';
import { resolveLayout } from '../content/resolve-layout';
import { BOUNDS } from '../content/street';
import {
  CHASE_PITCH,
  CHASE_TILT,
  CHASE_ZOOM,
  DEFAULT_TOP_DOWN_VIEW,
  type ScenePalette,
  type TopDownView,
} from '../contracts/render';
import { isKitDecor } from '../contracts/layout';
import type { Obb, Pose2 } from '../contracts/sim';
import { bodyFootprints } from '../sim/geometry';
import { joints, type KinematicState } from '../sim/kinematics';
import { trailers, trucks } from '../vehicles/registry';
import { resolveCombination } from '../vehicles/resolve';
import { CAB_HEIGHT, RELIEF } from './cab-dims';
import {
  CHASE_MAX_DISTANCE,
  cabFront,
  chaseColliders,
  createChaseArm,
  chaseDistance,
  boundingRadius,
  combinationExtent,
  createChaseCamera,
  placeChaseCamera,
  vehicleCentre,
  type ChaseFrame,
  type ChaseRig,
} from './chase-camera';
import { parseShell } from './glb-shells';
import { KEYS } from './palette';
import { AIDS_LAYER, CAB_LAYER, CAMERA_FAR, DEFAULT_LAYER, PERSPECTIVE_LAYER } from './seams';
import { skylineGeometry } from './skyline-geometry';
import { skylineBuildings } from './skyline-layout';
import { proceduralTruck } from './vehicle-visual';

// Landscape-screen pane, one with the HUD's free rect cut down to a corner, a square one and a wide strip.
const FRAMES: readonly ChaseFrame[] = [
  { width: 512, height: 800, clear: { x: 0, y: 0, width: 512, height: 800 } },
  { width: 540, height: 600, clear: { x: 0, y: 230, width: 300, height: 340 } },
  { width: 600, height: 600, clear: { x: 40, y: 20, width: 500, height: 540 } },
  { width: 1000, height: 400, clear: { x: 0, y: 0, width: 1000, height: 400 } },
];
const POSES: readonly Pose2[] = [
  { x: 0, y: 0, heading: 0 },
  { x: -23, y: 14, heading: 2.2 },
];
const YAWS = Array.from({ length: 12 }, (_, i) => (i * Math.PI) / 6 - Math.PI + 0.1);
const TILTS = [CHASE_TILT.min, 0, CHASE_TILT.max];
const ZOOMS = [CHASE_ZOOM.min, 1, CHASE_ZOOM.max];
/** Above any vehicle, light bars and roof racks included. */
const VEHICLE_TOP = 4.5;

const palette = Object.fromEntries(Object.keys(KEYS).map((k) => [k, 0x808080])) as ScenePalette;

const layersOf = (layer: number): Layers => {
  const layers = new Layers();
  layers.set(layer);
  return layers;
};

type Posed = {
  readonly rig: Omit<ChaseRig, 'colliders'>;
  readonly bodies: readonly Obb[];
};

/** The combination `trucks[t]` + `trailers[r]` with its truck at `pose` and the given joint angles. */
function posed(t: number, r: number, pose: Pose2, coupling: number, turntable: number): Posed {
  const truck = trucks[t];
  const trailer = trailers[r];
  if (truck === undefined || trailer === undefined) throw new Error('no such vehicle');
  const params = resolveCombination(truck, trailer);
  const th1 = pose.heading - coupling;
  const state: KinematicState = {
    x: pose.x,
    y: pose.y,
    th0: pose.heading,
    th1,
    th2: th1 - turntable,
  };
  const snapshot = joints(params, state);
  const face = cabFront(truck);
  return {
    rig: {
      truck: snapshot.truck,
      centre: vehicleCentre(snapshot, face.x),
      extent: combinationExtent(truck, trailer),
      face,
    },
    bodies: bodyFootprints(params, snapshot).map((f) => f.obb),
  };
}

const inside = (obb: Obb, x: number, y: number): boolean => {
  const dx = x - obb.cx;
  const dy = y - obb.cy;
  const along = dx * Math.cos(obb.heading) + dy * Math.sin(obb.heading);
  const across = -dx * Math.sin(obb.heading) + dy * Math.cos(obb.heading);
  return Math.abs(along) <= obb.halfLength && Math.abs(across) <= obb.halfWidth;
};

const aimOf = (rig: Posed['rig']): Vector3 =>
  new Vector3(rig.centre.x, (rig.face.bottom + rig.face.top) / 2, -rig.centre.y);

function place(rig: ChaseRig, frame: ChaseFrame, view: TopDownView): PerspectiveCamera {
  const camera = createChaseCamera();
  placeChaseCamera(camera, rig, frame, view);
  return camera;
}

const free = (rig: Posed['rig']): ChaseRig => ({ ...rig, colliders: [] });

describe('chase camera layers', () => {
  it('sees the cab, the perspective detail and the default layer, but no top-down aids', () => {
    const { layers } = createChaseCamera();
    expect(layers.test(layersOf(CAB_LAYER))).toBe(true);
    expect(layers.test(layersOf(PERSPECTIVE_LAYER))).toBe(true);
    expect(layers.test(layersOf(DEFAULT_LAYER))).toBe(true);
    expect(layers.test(layersOf(AIDS_LAYER))).toBe(false);
  });
});

describe('chase camera', () => {
  const pairs = trucks.flatMap((truck, t) =>
    trailers.map((trailer, r) => ({ name: `${truck.id} + ${trailer.id}`, t, r })),
  );
  /** Joint angles: straight, a hook either way, and the folds of both joints together. */
  const bends = (t: number, r: number): readonly (readonly [number, number])[] => {
    const truck = trucks[t];
    const trailer = trailers[r];
    if (truck === undefined || trailer === undefined) throw new Error('no such vehicle');
    const { couplingLimit: c, turntableLimit: u } = resolveCombination(truck, trailer);
    return [
      [0, 0],
      [c, 0],
      [-c, 0],
      [c, u],
      [c, -u],
      [-c, u],
    ];
  };

  it.each(pairs)(
    'keeps the eye above the ground and outside the vehicle, and the pivot in the free rect: $name',
    ({ t, r }) => {
      for (const pose of POSES) {
        for (const [coupling, turntable] of bends(t, r)) {
          const { rig, bodies } = posed(t, r, pose, coupling, turntable);
          const aim = aimOf(rig);
          for (const frame of FRAMES) {
            for (const panX of YAWS) {
              for (const panY of TILTS) {
                for (const zoom of ZOOMS) {
                  const label = `${frame.width}x${frame.height} yaw ${panX} tilt ${panY} zoom ${zoom} bend ${coupling},${turntable}`;
                  const camera = place(free(rig), frame, { zoom, panX, panY });
                  const { position } = camera;
                  expect(position.y, label).toBeGreaterThan(0);
                  expect(
                    position.y > VEHICLE_TOP ||
                      bodies.every((o) => !inside(o, position.x, -position.z)),
                    label,
                  ).toBe(true);
                  expect(position.distanceTo(aim), label).toBeGreaterThanOrEqual(
                    boundingRadius(rig.extent) - 1e-9,
                  );
                  expect(position.distanceTo(aim), label).toBeLessThanOrEqual(
                    CHASE_MAX_DISTANCE + 1e-9,
                  );
                  const ndc = aim.clone().project(camera);
                  const px = ((ndc.x + 1) / 2) * frame.width;
                  const py = ((1 - ndc.y) / 2) * frame.height;
                  const { clear } = frame;
                  expect(px, label).toBeGreaterThanOrEqual(clear.x - 1e-6);
                  expect(px, label).toBeLessThanOrEqual(clear.x + clear.width + 1e-6);
                  expect(py, label).toBeGreaterThanOrEqual(clear.y - 1e-6);
                  expect(py, label).toBeLessThanOrEqual(clear.y + clear.height + 1e-6);
                }
              }
            }
          }
        }
      }
    },
  );

  it.each(pairs)('frames the whole combination at the default view: $name', ({ t, r }) => {
    for (const frame of FRAMES) {
      for (const pose of POSES) {
        const { rig, bodies } = posed(t, r, pose, 0, 0);
        const camera = place(free(rig), frame, DEFAULT_TOP_DOWN_VIEW);
        const frustum = new Frustum().setFromProjectionMatrix(
          new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
        );
        for (const obb of bodies) {
          for (const a of [-1, 1]) {
            for (const b of [-1, 1]) {
              const cos = Math.cos(obb.heading);
              const sin = Math.sin(obb.heading);
              const x = obb.cx + a * obb.halfLength * cos - b * obb.halfWidth * sin;
              const y = obb.cy + a * obb.halfLength * sin + b * obb.halfWidth * cos;
              expect(
                frustum.containsPoint(new Vector3(x, 0, -y)),
                `${frame.width}x${frame.height} ${x},${y}`,
              ).toBe(true);
            }
          }
        }
      }
    }
  });

  it('tilts from the default pitch to the limits', () => {
    const { rig } = posed(0, 0, POSES[0] as Pose2, 0, 0);
    const frame = FRAMES[0] as ChaseFrame;
    const aim = aimOf(rig);
    const pitchOf = (panY: number): number => {
      const { position } = place(free(rig), frame, { zoom: 1, panX: 0, panY });
      return Math.atan2(position.y - aim.y, Math.hypot(position.x - aim.x, position.z - aim.z));
    };
    expect(pitchOf(0)).toBeCloseTo(CHASE_PITCH.default, 9);
    expect(pitchOf(CHASE_TILT.min - 1)).toBeCloseTo(CHASE_PITCH.min, 9);
    expect(pitchOf(CHASE_TILT.max + 1)).toBeCloseTo(CHASE_PITCH.max, 9);
  });

  it('draws the eye in before a collider that hides the pivot, down to the bounding radius, and lifts it over what is left', () => {
    const { rig } = posed(0, 0, POSES[0] as Pose2, 0, 0);
    const frame = FRAMES[0] as ChaseFrame;
    const aim = aimOf(rig);
    const clear = place(free(rig), frame, DEFAULT_TOP_DOWN_VIEW).position;
    const radius = boundingRadius(rig.extent);
    const wall = (distance: number, height: number, thick = 0.2): ChaseRig => {
      const cx = rig.centre.x + ((clear.x - aim.x) * distance) / clear.distanceTo(aim);
      const cy = rig.centre.y + ((-clear.z - rig.centre.y) * distance) / clear.distanceTo(aim);
      const obb: Obb = { cx, cy, halfLength: thick, halfWidth: 30, heading: 0.4 };
      return { ...rig, colliders: [{ obb, height }] };
    };
    const tall = place(wall(radius + 6, 50), frame, DEFAULT_TOP_DOWN_VIEW).position;
    expect(tall.distanceTo(aim)).toBeCloseTo(radius + 6 - 0.2 - 0.3, 0);
    const buried = place(wall(radius - 3, 50, 5), frame, DEFAULT_TOP_DOWN_VIEW).position;
    expect(buried.distanceTo(aim)).toBeGreaterThanOrEqual(radius);
    expect(buried.y).toBeGreaterThanOrEqual(50);
    const low = place(wall(radius + 6, 0.5), frame, DEFAULT_TOP_DOWN_VIEW).position;
    expect(low.distanceTo(clear)).toBeLessThan(1e-9);
    const zoomed = (zoom: number): number =>
      place(wall(radius + 6, 50), frame, { zoom, panX: 0, panY: 0 }).position.distanceTo(aim);
    expect(zoomed(2)).toBeLessThan(zoomed(1) - 1);
    expect(zoomed(CHASE_ZOOM.min)).toBeCloseTo(zoomed(1), 9);
    const aside = place(
      {
        ...rig,
        colliders: [
          { obb: { cx: 500, cy: 500, halfLength: 2, halfWidth: 2, heading: 0 }, height: 50 },
        ],
      },
      frame,
      DEFAULT_TOP_DOWN_VIEW,
    ).position;
    expect(aside.distanceTo(clear)).toBeLessThan(1e-9);
  });

  describe('arm', () => {
    const PULLED = 10;
    const OPEN = 30;
    /** An arm a collider has just pulled in to `PULLED`, at 0 ms. */
    const pulledIn = (): ReturnType<typeof createChaseArm> => {
      const arm = createChaseArm();
      arm.hold(OPEN, OPEN, -20);
      arm.hold(PULLED, OPEN, 0);
      return arm;
    };

    it('moves in at once and eases back out at the same pace whatever the frame rate', () => {
      const arm = createChaseArm();
      arm.hold(OPEN, OPEN, 0);
      expect(arm.hold(PULLED, OPEN, 20)).toBe(PULLED);
      const once = pulledIn().hold(OPEN, OPEN, 200);
      const stepped = pulledIn();
      let held = 0;
      for (let ms = 20; ms <= 200; ms += 20) held = stepped.hold(OPEN, OPEN, ms);
      expect(once).toBeGreaterThan(PULLED);
      expect(once).toBeLessThan(OPEN);
      expect(held).toBeCloseTo(once, 9);
    });

    it('steps out by a fraction of the way per frame, even after a stall', () => {
      expect(pulledIn().hold(OPEN, OPEN, 20) - PULLED).toBeLessThan(0.1 * (OPEN - PULLED));
      expect(pulledIn().hold(OPEN, OPEN, 10_000)).toBeLessThan(OPEN - 1);
    });

    it('follows the view at once when nothing holds it in, and starts afresh after a cut', () => {
      const arm = createChaseArm();
      arm.hold(OPEN, OPEN, 0);
      expect(arm.hold(CHASE_MAX_DISTANCE, 2 * OPEN, 20)).toBe(2 * OPEN);
      const released = pulledIn();
      let ms = 0;
      while (released.hold(OPEN, OPEN, (ms += 20)) < OPEN && ms < 60_000);
      expect(released.hold(CHASE_MAX_DISTANCE, 2 * OPEN, ms + 20)).toBe(2 * OPEN);
      const cut = pulledIn();
      cut.cut();
      expect(cut.hold(OPEN, OPEN, 20)).toBe(OPEN);
    });
  });

  it.each(Object.values(layouts))(
    'keeps the eye out of every collider and solid decor of the $id layout, from the start and from each of them',
    (layout) => {
      const resolved = resolveLayout(layout, null);
      const colliders = chaseColliders(resolved);
      // Named independently of chaseColliders, so dropping decor from it cannot hide a breach.
      const solid = [
        ...resolved.obstacles,
        ...resolved.decor.flatMap((d) =>
          isKitDecor(d) && /^(hall|office)-/.test(d.piece)
            ? [{ obb: d.footprint, height: KIT_FOOTPRINTS[d.piece].height }]
            : [],
        ),
      ];
      const spots: Pose2[] = [
        layout.start,
        ...solid.map((o) => ({ x: o.obb.cx, y: o.obb.cy, heading: o.obb.heading })),
      ];
      const frame = FRAMES[2] as ChaseFrame;
      const camera = createChaseCamera();
      const breaches: string[] = [];
      for (const spot of spots) {
        const { rig } = posed(0, 0, spot, 0, 0);
        const placed = { ...rig, colliders };
        for (const panX of YAWS) {
          for (const panY of TILTS) {
            placeChaseCamera(camera, placed, frame, { zoom: 1, panX, panY });
            const { x, y, z } = camera.position;
            const i = solid.findIndex((o) => y < o.height && inside(o.obb, x, -z));
            if (i >= 0) breaches.push(`collider ${i} yaw ${panX} tilt ${panY}`);
          }
        }
      }
      expect(breaches).toEqual([]);
    },
  );

  it.each(exercises)('sees the pivot past every collider at the start of $id', (exercise) => {
    const colliders = chaseColliders(resolveLayout(layouts[exercise.layout], exercise));
    const point = new Vector3();
    for (const { t, r } of pairs) {
      const { rig } = posed(t, r, exercise.start, 0, 0);
      const aim = aimOf(rig);
      for (const frame of FRAMES) {
        const { position } = place({ ...rig, colliders }, frame, DEFAULT_TOP_DOWN_VIEW);
        for (let s = 0; s <= 1; s += 1 / 256) {
          point.lerpVectors(aim, position, s);
          const hidden = colliders.some(
            (o) => inside(o.obb, point.x, -point.z) && point.y < o.height,
          );
          expect(hidden, `${frame.width}x${frame.height} at ${s}`).toBe(false);
        }
      }
    }
  });

  it('keeps the skyline inside the far plane from the farthest eye over the layout bounds', () => {
    const vertices = skylineGeometry(skylineBuildings(BOUNDS)).getAttribute('position');
    const vertex = new Vector3();
    let reach = 0;
    for (let i = 0; i < vertices.count; i++) {
      vertex.set(vertices.getX(i), vertices.getY(i), vertices.getZ(i));
      for (const x of [BOUNDS.minX, BOUNDS.maxX]) {
        for (const y of [BOUNDS.minY, BOUNDS.maxY]) {
          reach = Math.max(reach, vertex.distanceTo(new Vector3(x, 0, -y)));
        }
      }
    }
    expect(reach).toBeLessThan(CAMERA_FAR);
    expect(reach + CHASE_MAX_DISTANCE).toBeLessThan(createChaseCamera().far);
  });

  it('leaves the camera alone on a zero-size pane and keeps a collapsed free rect finite', () => {
    const { rig } = posed(0, 0, POSES[0] as Pose2, 0, 0);
    const camera = createChaseCamera();
    const before = camera.position.clone();
    const none = { x: 0, y: 0, width: 0, height: 0 };
    placeChaseCamera(
      camera,
      free(rig),
      { width: 0, height: 0, clear: none },
      DEFAULT_TOP_DOWN_VIEW,
    );
    expect(camera.position).toEqual(before);
    const collapsed = { width: 600, height: 600, clear: none };
    expect(chaseDistance(rig.extent, rig.face, collapsed)).toBeLessThan(CAMERA_FAR);
    const far = place(free(rig), collapsed, { zoom: CHASE_ZOOM.min, panX: 0, panY: 0 });
    expect(far.position.distanceTo(aimOf(rig))).toBeLessThanOrEqual(CHASE_MAX_DISTANCE + 1e-9);
  });
});

describe.each(trucks)('chase camera and the cab of $id', (spec) => {
  it('shows a cab to the chase camera without a loaded shell', () => {
    const { layers } = createChaseCamera();
    const truck = proceduralTruck(spec, palette).object;
    truck.updateMatrixWorld(true);
    let cabs = 0;
    truck.traverse((o) => {
      if (
        o instanceof Mesh &&
        o.layers.test(layers) &&
        new Box3().setFromObject(o).max.y >= CAB_HEIGHT - 1e-3
      ) {
        cabs++;
      }
    });
    expect(cabs).toBeGreaterThan(0);
  });

  it('is framed around the face the glb actually has', async () => {
    const bytes = readFileSync(join(import.meta.dirname, `assets/${spec.id}-cab.glb`));
    const { mesh } = await parseShell(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      'cab',
    );
    const face = cabFront(spec);
    const box = new Box3().setFromObject(mesh);
    const half = Math.max(-box.min.z, box.max.z);
    const tolerance = RELIEF + 1e-3;
    // The crew cab's tow coupling reaches 0.25 m past the face; the light bar and roof rack stand up to 0.3 m above the roof.
    expect(box.max.x).toBeGreaterThanOrEqual(face.x - tolerance);
    expect(box.max.x).toBeLessThanOrEqual(face.x + 0.25 + tolerance);
    expect(box.max.y).toBeGreaterThanOrEqual(face.top);
    expect(box.max.y).toBeLessThanOrEqual(face.top + 0.3);
    expect(box.min.y).toBeLessThanOrEqual(face.bottom);
    expect(Math.abs(half - face.halfWidth)).toBeLessThanOrEqual(tolerance);
  });
});
