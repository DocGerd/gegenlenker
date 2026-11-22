import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import {
  CHASE_AZIMUTH,
  CHASE_PITCH,
  CHASE_ZOOM,
  type Rect,
  type TopDownView,
} from '../contracts/render';
import type { Obstacle } from '../contracts/layout';
import type { Pose2, SimSnapshot, Vec2 } from '../contracts/sim';
import type { TrailerSpec, TruckSpec } from '../contracts/vehicle';
import { truckAnchors } from '../vehicles/anchors';
import { resolveCombination } from '../vehicles/resolve';
import { CAB_HEIGHT, FRAME_TOP } from './cab-dims';
import { CAMERA_FAR, CHASE_LAYERS, enableLayers } from './seams';

const CHASE_FOV = 40;
/** Distance beyond the one that just fits the combination's bounding sphere. */
const FIT_MARGIN = 1.1;
const MIN_ASPECT = 0.3;
/** Floor of the free rect's half-angle tangent, so a collapsed free rect cannot push the distance to infinity. */
const MIN_TAN_FIT = 0.1;
/** Farthest the eye gets from the pivot. */
export const CHASE_MAX_DISTANCE = 100;
/** The scenery is placed to stay inside `CAMERA_FAR` of the layout bounds; the eye may be this far outside them. */
const CHASE_FAR = CAMERA_FAR + CHASE_MAX_DISTANCE;
/** Metres the eye keeps above a collider it would otherwise sit inside, and around its footprint. */
const COLLIDER_CLEARANCE = 0.3;

/** The cab's front face in the truck body frame (x forward, y left, z up), metres. */
export type CabFront = {
  readonly x: number;
  readonly halfWidth: number;
  readonly bottom: number;
  readonly top: number;
};

export function createChaseCamera(): PerspectiveCamera {
  const camera = new PerspectiveCamera(CHASE_FOV, 1, 0.1, CHASE_FAR);
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

/** The pane the camera fills and the part of it the HUD leaves free, both in the pane's own px. */
export type ChaseFrame = {
  readonly width: number;
  readonly height: number;
  readonly clear: Rect;
};

const frameAspect = (frame: ChaseFrame): number => Math.max(frame.width / frame.height, MIN_ASPECT);

/** Distance at which a sphere of `radius` fills the narrower half-angle of the free rect. */
export function chaseDistance(radius: number, frame: ChaseFrame): number {
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

/** Metres added to the combination's bounding radius. */
const RADIUS_MARGIN = 1;

/** Metres from `vehicleCentre` that bound the whole combination, however it bends. */
export function combinationRadius(truck: TruckSpec, trailer: TrailerSpec): number {
  const p = resolveCombination(truck, trailer);
  const length =
    p.truckFront + p.couplingOffset + p.drawbar + p.trailerWheelbase + p.trailerRearOverhang;
  return length / 2 + Math.max(p.truckWidth, p.trailerWidth) / 2 + RADIUS_MARGIN;
}

/** The bumper-to-trailer-rear midpoint the follow views, the chase view and the sun shadow centre on. */
export function vehicleCentre(
  snapshot: Pick<SimSnapshot, 'truck' | 'trailerRear'>,
  frontX: number,
): Vec2 {
  const { truck, trailerRear } = snapshot;
  const bumperX = truck.x + Math.cos(truck.heading) * frontX;
  const bumperY = truck.y + Math.sin(truck.heading) * frontX;
  return { x: (bumperX + trailerRear.x) / 2, y: (bumperY + trailerRear.y) / 2 };
}

/** What the chase camera orbits and keeps clear of. */
export type ChaseRig = {
  /** Its heading is the zero of the orbit's yaw. */
  readonly truck: Pose2;
  /** The pivot, in the sim plane: `vehicleCentre`. */
  readonly centre: Vec2;
  /** Metres from `centre` that bound the whole combination. */
  readonly radius: number;
  readonly face: CabFront;
  /** The eye never sits inside one of these boxes. */
  readonly colliders: readonly Pick<Obstacle, 'obb' | 'height'>[];
};

const aim = new Vector3();
const eye = new Vector3();

/** The height the eye must clear at sim-plane point (`x`, `y`): the tallest collider box over it. */
function colliderTop(rig: ChaseRig, x: number, y: number): number {
  let top = 0;
  for (const { obb, height } of rig.colliders) {
    const cos = Math.cos(obb.heading);
    const sin = Math.sin(obb.heading);
    const dx = x - obb.cx;
    const dy = y - obb.cy;
    const along = dx * cos + dy * sin;
    const across = -dx * sin + dy * cos;
    if (
      Math.abs(along) <= obb.halfLength + COLLIDER_CLEARANCE &&
      Math.abs(across) <= obb.halfWidth + COLLIDER_CLEARANCE
    ) {
      top = Math.max(top, height + COLLIDER_CLEARANCE);
    }
  }
  return top;
}

/**
 * Orbits the combination's centre, framed in the part of the pane the HUD leaves free: `view.panX` turns the camera around it
 * (counter-clockwise from above, radians, from the truck's heading), `view.panY` tilts it from the default pitch and `view.zoom`
 * divides the fitted distance, which never drops below the combination's bounding radius.
 */
export function placeChaseCamera(
  camera: PerspectiveCamera,
  rig: ChaseRig,
  frame: ChaseFrame,
  view: TopDownView,
): void {
  if (frame.width <= 0 || frame.height <= 0) return;
  const { centre, truck, face } = rig;
  const azimuth = truck.heading + CHASE_AZIMUTH.default + view.panX;
  const pitch = MathUtils.clamp(CHASE_PITCH.default + view.panY, CHASE_PITCH.min, CHASE_PITCH.max);
  const distance = MathUtils.clamp(
    chaseDistance(rig.radius, frame) / MathUtils.clamp(view.zoom, CHASE_ZOOM.min, CHASE_ZOOM.max),
    rig.radius,
    Math.max(CHASE_MAX_DISTANCE, rig.radius),
  );
  const middle = (face.bottom + face.top) / 2;
  const horizontal = distance * Math.cos(pitch);
  const x = centre.x + horizontal * Math.cos(azimuth);
  const y = centre.y + horizontal * Math.sin(azimuth);
  aim.set(centre.x, middle, -centre.y);
  eye.set(x, Math.max(middle + distance * Math.sin(pitch), colliderTop(rig, x, y)), -y);
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
