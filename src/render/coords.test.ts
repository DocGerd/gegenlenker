import { Object3D, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { bodyToThree, placePose } from './coords';

it('maps body left to Three -z and agrees with an object placed by placePose', () => {
  const left = bodyToThree({ x: 0, y: 0, heading: 0 }, { x: 0, y: 1, z: 0 });
  expect([left.x, left.y, left.z]).toEqual([0, 0, -1]);

  const pose = { x: 3, y: -2, heading: 0.4 };
  const point = { x: 1.5, y: 0.7, z: 0.9 };
  const object = new Object3D();
  placePose(object, pose);
  object.updateMatrixWorld();
  const viaObject = object.localToWorld(new Vector3(point.x, point.z, -point.y));
  expect(bodyToThree(pose, point).distanceTo(viaObject)).toBeLessThan(1e-12);
});
