import type { OrthographicCamera } from 'three';
import type { TopDownView } from '../contracts/render';

type Centre = { readonly x: number; readonly y: number };

/** Frames the sim-plane `centre` shifted by `view.pan` base half-heights, `baseHalf` / `view.zoom` tall; the camera's height is the caller's. */
export function placeTopDownCamera(
  camera: OrthographicCamera,
  centre: Centre,
  baseHalf: number,
  aspect: number,
  view: TopDownView,
): void {
  const half = baseHalf / view.zoom;
  camera.left = -half * aspect;
  camera.right = half * aspect;
  camera.top = half;
  camera.bottom = -half;
  camera.position.x = centre.x + view.panX * baseHalf;
  camera.position.z = -(centre.y + view.panY * baseHalf);
  camera.updateProjectionMatrix();
}
