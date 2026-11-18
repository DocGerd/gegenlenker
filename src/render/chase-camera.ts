import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import {
  CHASE_AZIMUTH,
  CHASE_YAW,
  CHASE_ZOOM,
  type Rect,
  type TopDownView,
} from '../contracts/render';
import type { Pose2 } from '../contracts/sim';
import type { TruckSpec } from '../contracts/vehicle';
import { truckAnchors } from '../vehicles/anchors';
import { bodyToThree } from './coords';
import { CAB_HEIGHT, FRAME_TOP } from './cab-dims';
import { CAMERA_FAR, CHASE_LAYERS, enableLayers } from './seams';

const CHASE_FOV = 40;
const PITCH = MathUtils.degToRad(14);
/** Metres behind the front face that the camera looks at. */
const AIM_BEHIND_FRONT = 0.4;
/** Distance beyond the one that just fits the cab front's bounding sphere. */
const FIT_MARGIN = 1.25;
const MIN_ASPECT = 0.3;
/** Floor of the free rect's half-angle tangent, so a collapsed free rect cannot push the distance to infinity. */
const MIN_TAN_FIT = 0.1;

/** The cab's front face in the truck body frame (x forward, y left, z up), metres. */
export type CabFront = {
  readonly x: number;
  readonly halfWidth: number;
  readonly bottom: number;
  readonly top: number;
};

export function createChaseCamera(): PerspectiveCamera {
  const camera = new PerspectiveCamera(CHASE_FOV, 1, 0.1, CAMERA_FAR);
  enableLayers(camera.layers, CHASE_LAYERS);
  return camera;
}

export function cabFront(spec: TruckSpec): CabFront {
  return {
    x: truckAnchors(spec).frontX,
    halfWidth: spec.width.value / 2000,
    bottom: FRAME_TOP,
    top: CAB_HEIGHT,
  };
}

/** The face's four corners in the body frame. */
export function cabFrontCorners(face: CabFront): readonly (readonly [number, number, number])[] {
  return [-1, 1].flatMap((side) =>
    [face.bottom, face.top].map((z) => [face.x, side * face.halfWidth, z] as const),
  );
}

/** The pane the camera fills and the part of it the HUD leaves free, both in the pane's own px. */
export type ChaseFrame = {
  readonly width: number;
  readonly height: number;
  readonly clear: Rect;
};

const frameAspect = (frame: ChaseFrame): number => Math.max(frame.width / frame.height, MIN_ASPECT);

/** Distance at which the face's bounding sphere fills the narrower half-angle of the free rect. */
export function chaseDistance(face: CabFront, frame: ChaseFrame): number {
  const radius = Math.hypot(face.halfWidth, (face.top - face.bottom) / 2);
  const tanVertical = Math.tan(MathUtils.degToRad(CHASE_FOV / 2));
  const tanFit = Math.max(
    Math.min(
      tanVertical * (frame.clear.height / frame.height),
      tanVertical * frameAspect(frame) * (frame.clear.width / frame.width),
    ),
    MIN_TAN_FIT,
  );
  return (FIT_MARGIN * radius) / Math.sin(Math.atan(tanFit));
}

const aim = new Vector3();
const eye = new Vector3();
const offset = new Vector3();

/**
 * Orbits the cab front, framed in the part of the pane the HUD leaves free: `view.panX` turns the camera around the truck (counter-clockwise from
 * above, radians) and `view.zoom` divides the fitted distance. Both are clamped to the chase ranges, which keep the camera ahead of the cab front.
 */
export function placeChaseCamera(
  camera: PerspectiveCamera,
  pose: Pose2,
  face: CabFront,
  frame: ChaseFrame,
  view: TopDownView,
): void {
  if (frame.width <= 0 || frame.height <= 0) return;
  const azimuth = CHASE_AZIMUTH.default + MathUtils.clamp(view.panX, CHASE_YAW.min, CHASE_YAW.max);
  const distance =
    chaseDistance(face, frame) / MathUtils.clamp(view.zoom, CHASE_ZOOM.min, CHASE_ZOOM.max);
  const middle = (face.bottom + face.top) / 2;
  bodyToThree(pose, { x: face.x - AIM_BEHIND_FRONT, y: 0, z: middle }, aim);
  const horizontal = distance * Math.cos(PITCH);
  offset.set(
    face.x - AIM_BEHIND_FRONT + horizontal * Math.cos(azimuth),
    horizontal * Math.sin(azimuth),
    middle + distance * Math.sin(PITCH),
  );
  bodyToThree(pose, { x: offset.x, y: offset.y, z: offset.z }, eye);
  camera.fov = CHASE_FOV;
  camera.aspect = frameAspect(frame);
  camera.position.copy(eye);
  camera.lookAt(aim);
  // Moves the aim from the pane's centre to the free rect's.
  const { clear } = frame;
  const shiftX = clear.x + clear.width / 2 - frame.width / 2;
  const shiftY = clear.y + clear.height / 2 - frame.height / 2;
  camera.setViewOffset(frame.width, frame.height, -shiftX, -shiftY, frame.width, frame.height);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}
