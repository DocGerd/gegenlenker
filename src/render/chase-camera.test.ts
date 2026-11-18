import { Frustum, Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TOP_DOWN_VIEW } from '../contracts/render';
import type { Pose2 } from '../contracts/sim';
import { CHASE_YAW_LIMIT, ZOOM_LIMITS } from '../input/top-down-view';
import { trucks } from '../vehicles/registry';
import { bodyToThree } from './coords';
import { cabFront, cabFrontCorners, placeChaseCamera, type ChaseFrame } from './chase-camera';
import { CAMERA_FAR } from './seams';

// Landscape-screen pane, one with the HUD's free rect cut down to a corner, a square one and a portrait strip.
const FRAMES: readonly ChaseFrame[] = [
  { width: 512, height: 800, clear: { x: 0, y: 0, width: 512, height: 800 } },
  { width: 540, height: 600, clear: { x: 0, y: 230, width: 300, height: 340 } },
  { width: 600, height: 600, clear: { x: 40, y: 20, width: 500, height: 540 } },
  { width: 1000, height: 400, clear: { x: 0, y: 0, width: 1000, height: 400 } },
];
const POSES = [
  { x: 0, y: 0, heading: 0 },
  { x: -23, y: 14, heading: 2.2 },
];

describe.each(trucks)('chase camera, $id', (spec) => {
  const face = cabFront(spec);

  it.each(FRAMES)(
    'frames the whole cab front, from outside it, in the free rect of $width x $height',
    (frame) => {
      for (const pose of POSES) {
        const camera = new PerspectiveCamera(40, 1, 0.1, CAMERA_FAR);
        placeChaseCamera(camera, pose, face, frame, DEFAULT_TOP_DOWN_VIEW);
        const frustum = new Frustum().setFromProjectionMatrix(
          new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
        );
        const point = new Vector3();
        for (const [x, y, z] of cabFrontCorners(face)) {
          bodyToThree(pose, { x, y, z }, point);
          expect(frustum.containsPoint(point), `corner ${x},${y},${z}`).toBe(true);
          const ndc = point.clone().project(camera);
          const px = ((ndc.x + 1) / 2) * frame.width;
          const py = ((1 - ndc.y) / 2) * frame.height;
          const { clear } = frame;
          expect(px, `corner ${x},${y},${z} x`).toBeGreaterThanOrEqual(clear.x);
          expect(px, `corner ${x},${y},${z} x`).toBeLessThanOrEqual(clear.x + clear.width);
          expect(py, `corner ${x},${y},${z} y`).toBeGreaterThanOrEqual(clear.y);
          expect(py, `corner ${x},${y},${z} y`).toBeLessThanOrEqual(clear.y + clear.height);
        }
        // On the outward side of the front plane, so the camera sees the face and not the cab's back.
        const eye = camera.position.clone();
        const forward = new Vector3(Math.cos(pose.heading), 0, -Math.sin(pose.heading));
        const middle = bodyToThree(pose, { x: face.x, y: 0, z: (face.bottom + face.top) / 2 });
        const toEye = eye.sub(middle);
        const incidence = Math.acos(toEye.normalize().dot(forward));
        expect(incidence).toBeGreaterThan(0.3);
        expect(incidence).toBeLessThan(1.2);
      }
    },
  );

  it('keeps the camera out of the cab at the ends of the orbit', () => {
    const frame = FRAMES[0] as ChaseFrame;
    for (const panX of [-CHASE_YAW_LIMIT, CHASE_YAW_LIMIT]) {
      const camera = new PerspectiveCamera(40, 1, 0.1, CAMERA_FAR);
      placeChaseCamera(camera, POSES[0] as Pose2, face, frame, {
        zoom: ZOOM_LIMITS.chase.max,
        panX,
        panY: 0,
      });
      // The first pose is the origin with heading 0: body x is three x, body y is -z.
      const inside =
        Math.abs(camera.position.z) < face.halfWidth &&
        camera.position.x < face.x &&
        camera.position.y < face.top;
      expect(inside, `yaw ${panX}`).toBe(false);
    }
  });
});
