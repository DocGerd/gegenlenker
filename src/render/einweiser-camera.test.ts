import { Layers, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { Pose2 } from '../contracts/sim';
import { HEAD_HEIGHT } from '../einweiser/sight';
import { createEinweiserCamera, placeEinweiserCamera, verticalFov } from './einweiser-camera';
import { AIDS_LAYER, CAB_LAYER, INTERIOR_LAYER, PERSPECTIVE_LAYER } from './seams';

const HEADINGS = [0, Math.PI / 2, -2.2, 3];
const WIDE = { width: 1600, height: 900 };

/** The sim-plane point `ahead` m along `pose`'s heading and `left` m to its left, `z` m up, in Three space. */
const at = (pose: Pose2, ahead: number, left: number, z: number): Vector3 => {
  const [c, s] = [Math.cos(pose.heading), Math.sin(pose.heading)];
  return new Vector3(pose.x + c * ahead - s * left, z, -(pose.y + s * ahead + c * left));
};

describe('Einweiser camera', () => {
  it.each(HEADINGS)('stands at his eye and looks along his heading, heading %f', (heading) => {
    const pose: Pose2 = { x: 7, y: -3, heading };
    const camera = createEinweiserCamera();
    placeEinweiserCamera(camera, { pose, pitch: 0 }, WIDE);

    expect(camera.position.distanceTo(new Vector3(7, HEAD_HEIGHT, 3))).toBeCloseTo(0, 9);
    const ahead = at(pose, 20, 0, HEAD_HEIGHT).project(camera);
    expect(ahead.x).toBeCloseTo(0, 9);
    expect(ahead.y).toBeCloseTo(0, 9);
    expect(at(pose, 20, 2, HEAD_HEIGHT).project(camera).x).toBeLessThan(0);
  });

  it('looks up with a positive pitch', () => {
    const pose: Pose2 = { x: 0, y: 0, heading: 1 };
    const camera = createEinweiserCamera();
    const pitch = 0.3;
    placeEinweiserCamera(camera, { pose, pitch }, WIDE);

    const up = at(pose, 10 * Math.cos(pitch), 0, HEAD_HEIGHT + 10 * Math.sin(pitch));
    expect(up.project(camera).y).toBeCloseTo(0, 9);
  });

  it.each([70, 90, 110])('spans %i° across a 16:9 pane and keeps it vertical elsewhere', (fov) => {
    const pose: Pose2 = { x: 0, y: 0, heading: 0 };
    const camera = createEinweiserCamera();
    placeEinweiserCamera(camera, { pose, pitch: 0 }, WIDE, fov);
    const half = (fov * Math.PI) / 360;
    expect(at(pose, 1, Math.tan(half), HEAD_HEIGHT).project(camera).x).toBeCloseTo(-1, 9);

    const vertical = camera.fov;
    placeEinweiserCamera(camera, { pose, pitch: 0 }, { width: 1200, height: 900 }, fov);
    expect(camera.fov).toBe(vertical);
    expect(verticalFov(fov)).toBeLessThan(fov);
  });

  it('sees the perspective scene and the cab exterior, not the cab interior or the aids', () => {
    const camera = createEinweiserCamera();
    const on = (layer: number): boolean => {
      const object = new Layers();
      object.set(layer);
      return camera.layers.test(object);
    };
    expect([PERSPECTIVE_LAYER, CAB_LAYER].every(on)).toBe(true);
    expect([INTERIOR_LAYER, AIDS_LAYER].some(on)).toBe(false);
  });
});
