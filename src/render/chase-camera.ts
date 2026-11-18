import { MathUtils, Vector3, type PerspectiveCamera } from 'three';
import type { Rect, TopDownView } from '../contracts/render';
import type { Pose2 } from '../contracts/sim';
import type { TruckSpec } from '../contracts/vehicle';
import { truckAnchors } from '../vehicles/anchors';
import { bodyToThree } from './coords';
import { CAB_HEIGHT, FRAME_TOP } from './cab-dims';

export const CHASE_FOV = 40;
/** Camera azimuth from the truck's forward axis, counter-clockwise from above: ahead of the cab, off its left front. */
const DEFAULT_AZIMUTH = MathUtils.degToRad(38);
const PITCH = MathUtils.degToRad(14);
/** Metres behind the front face that the camera looks at. */
const AIM_BEHIND_FRONT = 0.4;
/** Distance beyond the one that just fits the cab front's bounding sphere. */
const FIT_MARGIN = 1.25;
const MIN_ASPECT = 0.3;

/** The cab's front face in the truck body frame (x forward, y left, z up), metres. */
export type CabFront = {
  readonly x: number;
  readonly halfWidth: number;
  readonly bottom: number;
  readonly top: number;
};

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

/** Distance at which the face's bounding sphere fills the narrower half-angle of the free rect. */
export function chaseDistance(face: CabFront, frame: ChaseFrame): number {
  const radius = Math.hypot(face.halfWidth, (face.top - face.bottom) / 2);
  const tanVertical = Math.tan(MathUtils.degToRad(CHASE_FOV / 2));
  const aspect = Math.max(frame.width / frame.height, MIN_ASPECT);
  const tanFit = Math.min(
    tanVertical * (frame.clear.height / frame.height),
    tanVertical * aspect * (frame.clear.width / frame.width),
  );
  return (FIT_MARGIN * radius) / Math.sin(Math.atan(tanFit));
}

const aim = new Vector3();
const eye = new Vector3();
const offset = new Vector3();

/**
 * Orbits the cab front, framed in the part of the pane the HUD leaves free: `view.panX` turns the camera around the truck (counter-clockwise from
 * above, radians) and `view.zoom` divides the fitted distance.
 */
export function placeChaseCamera(
  camera: PerspectiveCamera,
  pose: Pose2,
  face: CabFront,
  frame: ChaseFrame,
  view: TopDownView,
): void {
  const azimuth = DEFAULT_AZIMUTH + view.panX;
  const distance = chaseDistance(face, frame) / view.zoom;
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
  camera.aspect = frame.width / frame.height;
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
