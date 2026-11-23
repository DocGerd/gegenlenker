import { MathUtils, type PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { Pose2 } from '../contracts/sim';
import { truckAnchors } from '../vehicles/anchors';
import { trucks } from '../vehicles/registry';
import { bodyToThree } from './coords';
import { createCockpitCamera, placeCockpitCamera } from './cockpit-camera';

const HEADINGS = [0, Math.PI / 2, -2.2, 3];
const PANE = { width: 1280, height: 720 };

describe.each(trucks)('cockpit camera of $id', (truck) => {
  const anchors = truckAnchors(truck);

  it.each(HEADINGS)('sits at the left eye, heading %f', (heading) => {
    const pose: Pose2 = { x: 7, y: -3, heading };
    const camera = createCockpitCamera();
    placeCockpitCamera(camera, pose, anchors.eye, PANE);

    expect(anchors.eye.y).toBeGreaterThan(0);
    expect(camera.position.distanceTo(bodyToThree(pose, anchors.eye))).toBeCloseTo(0, 9);
  });

  it.each(HEADINGS)(
    'looks straight ahead; the cab front centre is to the right, heading %f',
    (heading) => {
      const pose: Pose2 = { x: 7, y: -3, heading };
      const camera = createCockpitCamera();
      placeCockpitCamera(camera, pose, anchors.eye, PANE);

      const ahead = bodyToThree(pose, {
        x: anchors.eye.x + 20,
        y: anchors.eye.y,
        z: anchors.eye.z,
      });
      expect(ahead.project(camera).x).toBeCloseTo(0, 9);

      const centre = new Vector3();
      bodyToThree(pose, { x: anchors.frontX, y: 0, z: anchors.eye.z }, centre);
      expect(centre.project(camera).x).toBeGreaterThan(0);
    },
  );

  it.each(HEADINGS)('turns with the head about the eye, heading %f', (truckHeading) => {
    const pose: Pose2 = { x: 7, y: -3, heading: truckHeading };
    const rest = createCockpitCamera();
    placeCockpitCamera(rest, pose, anchors.eye, PANE);
    const camera = createCockpitCamera();
    const yaw = MathUtils.degToRad(40);
    const pitch = MathUtils.degToRad(8);
    placeCockpitCamera(camera, pose, anchors.eye, PANE, { yaw, pitch });

    expect(camera.position.distanceTo(rest.position)).toBeCloseTo(0, 9);
    const along = (c: PerspectiveCamera): Vector3 => c.getWorldDirection(new Vector3());
    const [a, b] = [along(rest), along(camera)];
    // the sim plane's heading: counter-clockwise positive, so positive yaw looks left
    const heading = (v: Vector3): number => Math.atan2(-v.z, v.x);
    const turned = heading(b) - heading(a);
    expect(Math.atan2(Math.sin(turned), Math.cos(turned))).toBeCloseTo(yaw, 9);
    expect(Math.asin(b.y) - Math.asin(a.y)).toBeCloseTo(pitch, 9);
  });
});
