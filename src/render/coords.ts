import { Vector3, type Object3D } from 'three';
import type { Pose2 } from '../contracts/sim';
import type { Vec3 } from '../contracts/vehicle';

/** Sets the ground position and heading; the object's own height is kept. */
export function placePose(object: Object3D, pose: Pose2): void {
  object.position.x = pose.x;
  object.position.z = -pose.y;
  object.rotation.y = pose.heading;
}

/** A point in a body frame (x forward, y left, z up) as a Three position, written into `out`. */
export function bodyToThree(pose: Pose2, point: Vec3, out: Vector3 = new Vector3()): Vector3 {
  const c = Math.cos(pose.heading);
  const s = Math.sin(pose.heading);
  return out.set(
    pose.x + c * point.x - s * point.y,
    point.z,
    -(pose.y + s * point.x + c * point.y),
  );
}
