import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Box3, Frustum, Layers, Matrix4, Mesh, Vector3, type PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import {
  CHASE_AZIMUTH,
  CHASE_YAW,
  CHASE_ZOOM,
  DEFAULT_TOP_DOWN_VIEW,
  type ScenePalette,
  type TopDownView,
} from '../contracts/render';
import type { Pose2 } from '../contracts/sim';
import { trucks } from '../vehicles/registry';
import { CAB_HEIGHT, RELIEF } from './cab-dims';
import {
  cabFront,
  cabFrontCorners,
  chaseDistance,
  createChaseCamera,
  placeChaseCamera,
  type CabFront,
  type ChaseFrame,
} from './chase-camera';
import { bodyToThree } from './coords';
import { parseShell } from './glb-shells';
import { KEYS } from './palette';
import { AIDS_LAYER, CAB_LAYER, CAMERA_FAR, DEFAULT_LAYER, PERSPECTIVE_LAYER } from './seams';
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
const VIEWS: readonly TopDownView[] = [
  DEFAULT_TOP_DOWN_VIEW,
  { zoom: CHASE_ZOOM.min, panX: 0, panY: 0 },
];
/** Metres the camera must stay ahead of the cab front plane at the ends of the orbit. */
const FRONT_CLEARANCE = 0.3;

const palette = Object.fromEntries(Object.keys(KEYS).map((k) => [k, 0x808080])) as ScenePalette;

const layersOf = (layer: number): Layers => {
  const layers = new Layers();
  layers.set(layer);
  return layers;
};

function place(
  pose: Pose2,
  face: CabFront,
  frame: ChaseFrame,
  view: TopDownView,
): PerspectiveCamera {
  const camera = createChaseCamera();
  placeChaseCamera(camera, pose, face, frame, view);
  return camera;
}

const forwardOf = (pose: Pose2): Vector3 =>
  new Vector3(Math.cos(pose.heading), 0, -Math.sin(pose.heading));

describe('chase camera layers', () => {
  it('sees the cab, the perspective detail and the default layer, but no top-down aids', () => {
    const { layers } = createChaseCamera();
    expect(layers.test(layersOf(CAB_LAYER))).toBe(true);
    expect(layers.test(layersOf(PERSPECTIVE_LAYER))).toBe(true);
    expect(layers.test(layersOf(DEFAULT_LAYER))).toBe(true);
    expect(layers.test(layersOf(AIDS_LAYER))).toBe(false);
  });
});

describe.each(trucks)('chase camera, $id', (spec) => {
  const face = cabFront(spec);

  it.each(FRAMES)(
    'frames the whole cab front, from outside it, in the free rect of $width x $height',
    (frame) => {
      for (const pose of POSES) {
        for (const view of VIEWS) {
          const camera = place(pose, face, frame, view);
          const frustum = new Frustum().setFromProjectionMatrix(
            new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
          );
          const point = new Vector3();
          for (const [x, y, z] of cabFrontCorners(face)) {
            const label = `corner ${x},${y},${z} at zoom ${view.zoom}`;
            bodyToThree(pose, { x, y, z }, point);
            expect(frustum.containsPoint(point), label).toBe(true);
            expect(camera.position.distanceTo(point), label).toBeLessThan(CAMERA_FAR);
            const ndc = point.clone().project(camera);
            const px = ((ndc.x + 1) / 2) * frame.width;
            const py = ((1 - ndc.y) / 2) * frame.height;
            const { clear } = frame;
            expect(px, label).toBeGreaterThanOrEqual(clear.x);
            expect(px, label).toBeLessThanOrEqual(clear.x + clear.width);
            expect(py, label).toBeGreaterThanOrEqual(clear.y);
            expect(py, label).toBeLessThanOrEqual(clear.y + clear.height);
          }
          // On the outward side of the front plane, so the camera sees the face and not the cab's back.
          const middle = bodyToThree(pose, { x: face.x, y: 0, z: (face.bottom + face.top) / 2 });
          const toEye = camera.position.clone().sub(middle).normalize();
          const incidence = Math.acos(toEye.dot(forwardOf(pose)));
          expect(incidence).toBeGreaterThan(0.3);
          expect(incidence).toBeLessThan(1.2);
        }
      }
    },
  );

  it.each(FRAMES)(
    'stays ahead of the cab front at the ends of the orbit, even for an unclamped view ($width x $height)',
    (frame) => {
      for (const panX of [CHASE_YAW.min, CHASE_YAW.max, -10, 10]) {
        const view = { zoom: CHASE_ZOOM.max * 10, panX, panY: 0 };
        for (const pose of POSES) {
          const camera = place(pose, face, frame, view);
          const plane = bodyToThree(pose, { x: face.x, y: 0, z: 0 });
          const ahead = camera.position.clone().sub(plane).dot(forwardOf(pose));
          expect(ahead, `yaw ${panX}`).toBeGreaterThanOrEqual(FRONT_CLEARANCE);
        }
      }
    },
  );

  it('turns the camera exactly to the azimuth limits at the ends of the yaw range', () => {
    const frame = FRAMES[0] as ChaseFrame;
    const pose = POSES[0] as Pose2;
    const azimuth = (panX: number): number => {
      const { position } = place(pose, face, frame, { zoom: 1, panX, panY: 0 });
      return Math.atan2(-position.z, position.x - (face.x - 0.4));
    };
    expect(azimuth(CHASE_YAW.min)).toBeCloseTo(-CHASE_AZIMUTH.limit, 6);
    expect(azimuth(CHASE_YAW.max)).toBeCloseTo(CHASE_AZIMUTH.limit, 6);
  });

  it('leaves the camera alone on a zero-size pane and keeps a collapsed free rect finite', () => {
    const camera = createChaseCamera();
    const before = camera.position.clone();
    const none = { x: 0, y: 0, width: 0, height: 0 };
    placeChaseCamera(
      camera,
      POSES[0] as Pose2,
      face,
      { width: 0, height: 0, clear: none },
      DEFAULT_TOP_DOWN_VIEW,
    );
    expect(camera.position).toEqual(before);
    const collapsed = chaseDistance(face, { width: 600, height: 600, clear: none });
    expect(collapsed / CHASE_ZOOM.min).toBeLessThan(CAMERA_FAR);
  });

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
});

describe.each(trucks)('chase camera and the cab shell of $id', (spec) => {
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
