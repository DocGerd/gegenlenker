import { PerspectiveCamera } from 'three';
import { DEFAULT_EINWEISER_FOV, type EinweiserVisual, type Rect } from '../contracts/render';
import { HEAD_HEIGHT } from '../einweiser/sight';
import { CAMERA_FAR, EINWEISER_LAYERS, enableLayers } from './seams';

/** The aspect the Einweiser's horizontal field of view is given at. */
export const FOV_ASPECT = 16 / 9;

/** Three's vertical `fov` (degrees) for `horizontal` degrees at `FOV_ASPECT`: Hor+, so a wider pane sees more to the sides. */
export function verticalFov(horizontal: number): number {
  const half = (horizontal * Math.PI) / 360;
  return (360 / Math.PI) * Math.atan(Math.tan(half) / FOV_ASPECT);
}

export function createEinweiserCamera(): PerspectiveCamera {
  const camera = new PerspectiveCamera(verticalFov(DEFAULT_EINWEISER_FOV), 1, 0.1, CAMERA_FAR);
  camera.rotation.order = 'YXZ';
  enableLayers(camera.layers, EINWEISER_LAYERS);
  return camera;
}

/** Puts the camera at his eye, `HEAD_HEIGHT` over his live pose, looking along his heading and pitch, filling `pane`. */
export function placeEinweiserCamera(
  camera: PerspectiveCamera,
  { pose, pitch }: Pick<EinweiserVisual, 'pose' | 'pitch'>,
  pane: Pick<Rect, 'width' | 'height'>,
  horizontalFov = DEFAULT_EINWEISER_FOV,
): void {
  camera.position.set(pose.x, HEAD_HEIGHT, -pose.y);
  camera.rotation.set(pitch, pose.heading - Math.PI / 2, 0);
  camera.fov = verticalFov(horizontalFov);
  camera.aspect = pane.width / pane.height;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}
