import { MathUtils, PerspectiveCamera } from 'three';
import type { Rect } from '../contracts/render';
import type { Pose2 } from '../contracts/sim';
import type { Vec3 } from '../contracts/vehicle';
import { COCKPIT_FOV } from './cockpit-band';
import { bodyToThree } from './coords';
import { CAMERA_FAR, COCKPIT_LAYERS, enableLayers } from './seams';

export { COCKPIT_FOV };
export const COCKPIT_PITCH = MathUtils.degToRad(-6);

export function createCockpitCamera(): PerspectiveCamera {
  const camera = new PerspectiveCamera(COCKPIT_FOV, 1, 0.1, CAMERA_FAR);
  camera.rotation.order = 'YXZ';
  enableLayers(camera.layers, COCKPIT_LAYERS);
  return camera;
}

/** Puts the camera at the body-frame `eye` of a truck at `pose`, looking along its heading, filling `pane`. */
export function placeCockpitCamera(
  camera: PerspectiveCamera,
  pose: Pose2,
  eye: Vec3,
  pane: Pick<Rect, 'width' | 'height'>,
): void {
  bodyToThree(pose, eye, camera.position);
  camera.rotation.set(COCKPIT_PITCH, pose.heading - Math.PI / 2, 0);
  camera.aspect = pane.width / pane.height;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}
