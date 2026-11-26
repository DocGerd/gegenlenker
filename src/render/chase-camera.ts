import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import {
  CHASE_AZIMUTH,
  CHASE_PITCH,
  CHASE_ZOOM,
  type FreePose,
  type Rect,
  type TopDownView,
} from '../contracts/render';
import { KIT_FOOTPRINTS } from '../content/kit';
import { isKitDecor, type KitPiece, type Obstacle, type ResolvedLayout } from '../contracts/layout';
import type { Pose2, SimSnapshot, Vec2 } from '../contracts/sim';
import type { TrailerSpec, TruckSpec } from '../contracts/vehicle';
import { truckAnchors } from '../vehicles/anchors';
import { resolveCombination } from '../vehicles/resolve';
import { CAB_HEIGHT, FRAME_TOP } from './cab-dims';
import { FREE_FOV, poseFromGaze } from './free-look';
import { CAMERA_FAR, CHASE_LAYERS, enableLayers } from './seams';
import { sceneryBuildings } from './skyline-layout';

const CHASE_FOV = FREE_FOV;
/** Distance beyond the one that just fits the combination. */
const FIT_MARGIN = 1.1;
const MIN_ASPECT = 0.3;
/** Floor of the free rect's half-angle tangent, so a collapsed free rect cannot push the distance to infinity. */
const MIN_TAN_FIT = 0.1;
/** Farthest the eye gets from the pivot. */
export const CHASE_MAX_DISTANCE = 80;
/** The scenery is placed to stay inside `CAMERA_FAR` of the layout bounds; the eye may be this far outside them. */
const CHASE_FAR = CAMERA_FAR + CHASE_MAX_DISTANCE;
/** Metres the eye keeps above a collider it would otherwise sit inside, and around its footprint. */
const COLLIDER_CLEARANCE = 0.3;
/** Metres the eye stops short of a grown collider box, so rounding never counts it inside. */
const ENTRY_GAP = 1e-3;
/** Time constant of the eye easing back out once a collider stops hiding the pivot. */
const RELEASE_SECONDS = 0.5;
const MAX_RELEASE_STEP_SECONDS = 0.25;
/** Metres short of its target at which an easing eye counts as released. */
const RELEASED = 1e-3;
/** Decor the eye must not enter: walled buildings, not trees, poles or goods. */
const SOLID_DECOR: ReadonlySet<KitPiece> = new Set([
  'hall-corner',
  'hall-door-bay',
  'hall-roof',
  'hall-wall-bay',
  'office-bay',
  'office-entrance',
  'office-roof',
]);

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

/** The combination straight, from its centre: half its length and half its widest body, metres. */
export type CombinationExtent = { readonly halfLength: number; readonly halfWidth: number };

export function combinationExtent(truck: TruckSpec, trailer: TrailerSpec): CombinationExtent {
  const p = resolveCombination(truck, trailer);
  const length =
    p.truckFront + p.couplingOffset + p.drawbar + p.trailerWheelbase + p.trailerRearOverhang;
  return { halfLength: length / 2, halfWidth: Math.max(p.truckWidth, p.trailerWidth) / 2 };
}

/** Metres added to the combination's bounding radius. */
const RADIUS_MARGIN = 1;

/** Metres from `vehicleCentre` that bound the whole combination, however it bends. */
export const boundingRadius = ({ halfLength, halfWidth }: CombinationExtent): number =>
  halfLength + halfWidth + RADIUS_MARGIN;

/** The height the camera aims at, and the one a combination of `face`'s cab stands up to, metres. */
const aimHeight = (face: CabFront): number => (face.bottom + face.top) / 2;

/**
 * Distance at which the straight combination's bounding box, seen from the default azimuth and
 * pitch, fills the free rect. A bent combination can reach past it: the zoom range covers the bounding sphere.
 */
export function chaseDistance(
  extent: CombinationExtent,
  face: CabFront,
  frame: ChaseFrame,
): number {
  const azimuth = CHASE_AZIMUTH.default;
  const pitch = CHASE_PITCH.default;
  const toEye = new Vector3(
    Math.cos(pitch) * Math.cos(azimuth),
    Math.cos(pitch) * Math.sin(azimuth),
    Math.sin(pitch),
  );
  const right = new Vector3(-Math.sin(azimuth), Math.cos(azimuth), 0);
  const up = new Vector3().crossVectors(toEye, right).negate();
  const tanVertical = Math.tan(MathUtils.degToRad(CHASE_FOV / 2));
  const tanAcross = Math.max(
    tanVertical * frameAspect(frame) * (frame.clear.width / frame.width),
    MIN_TAN_FIT,
  );
  const tanUp = Math.max(tanVertical * (frame.clear.height / frame.height), MIN_TAN_FIT);
  const middle = aimHeight(face);
  const corner = new Vector3();
  let distance = 0;
  for (const x of [-1, 1]) {
    for (const y of [-1, 1]) {
      for (const z of [-middle, face.top - middle]) {
        corner.set(x * extent.halfLength, y * extent.halfWidth, z);
        // a corner nearer the eye than the pivot, by `t`, needs that much more distance
        const t = corner.dot(toEye);
        distance = Math.max(
          distance,
          Math.abs(corner.dot(right)) / tanAcross + t,
          Math.abs(corner.dot(up)) / tanUp + t,
        );
      }
    }
  }
  return FIT_MARGIN * distance;
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
  readonly extent: CombinationExtent;
  readonly face: CabFront;
  /** The eye never sits inside one of these boxes. */
  readonly colliders: readonly ChaseCollider[];
};

export type ChaseCollider = Pick<Obstacle, 'obb' | 'height'>;

/** The layout's obstacles, its solid decor and the skyline around it: nothing drives into them, but the eye could reach them. */
export function chaseColliders(
  layout: Pick<ResolvedLayout, 'obstacles' | 'decor' | 'bounds' | 'surfaces'>,
): readonly ChaseCollider[] {
  const solids = layout.decor.flatMap((d) =>
    isKitDecor(d) && SOLID_DECOR.has(d.piece)
      ? [{ obb: d.footprint, height: KIT_FOOTPRINTS[d.piece].height }]
      : [],
  );
  const scenery = sceneryBuildings(layout).map((b) => ({
    obb: { cx: b.x, cy: b.y, halfLength: b.length / 2, halfWidth: b.depth / 2, heading: b.heading },
    height: b.height,
  }));
  return [...layout.obstacles, ...solids, ...scenery];
}

/**
 * Holds the collider limit on the eye distance across frames: the eye moves in at once when a collider
 * starts to hide the pivot and eases back out when it stops, so a gap the pivot ray slips through does
 * not pop it out and back.
 */
export type ChaseArm = {
  /**
   * `limit` is this frame's collider limit, `open` the distance the view takes without colliders,
   * `now` in ms; returns the limit to use.
   */
  hold(limit: number, open: number, now: number): number;
  /** The next `hold` takes its limit as it is. */
  cut(): void;
};

export function createChaseArm(): ChaseArm {
  let held = 0;
  let lastOpen = 0;
  let at = -1;
  return {
    hold(limit, open, now) {
      const target = Math.min(limit, open);
      // an eye that was not held in follows the view at once
      if (at < 0 || target <= held || held >= lastOpen) {
        held = target;
      } else {
        const step = Math.min(Math.max(now - at, 0) / 1000, MAX_RELEASE_STEP_SECONDS);
        held += (target - held) * (1 - Math.exp(-step / RELEASE_SECONDS));
        if (target - held < RELEASED) held = target;
      }
      at = now;
      lastOpen = open;
      return held;
    },
    cut() {
      at = -1;
    },
  };
}

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
 * How far from (`x`, `y`, `z`) (sim plane, z up) along the unit direction (`dx`, `dy`, `dz`) the ray
 * first enters a collider box grown by `COLLIDER_CLEARANCE`; infinity when it enters none. A ray that
 * starts inside a box has no entry.
 */
function firstEntry(
  rig: ChaseRig,
  from: readonly [number, number, number],
  dir: readonly [number, number, number],
): number {
  let nearest = Infinity;
  for (const { obb, height } of rig.colliders) {
    const cos = Math.cos(obb.heading);
    const sin = Math.sin(obb.heading);
    const ox = from[0] - obb.cx;
    const oy = from[1] - obb.cy;
    // the ray in the box's frame, against its slabs along, across and up
    const origin = [ox * cos + oy * sin, -ox * sin + oy * cos, from[2]];
    const step = [dir[0] * cos + dir[1] * sin, -dir[0] * sin + dir[1] * cos, dir[2]];
    const low = [
      -obb.halfLength - COLLIDER_CLEARANCE,
      -obb.halfWidth - COLLIDER_CLEARANCE,
      -COLLIDER_CLEARANCE,
    ];
    const high = [
      obb.halfLength + COLLIDER_CLEARANCE,
      obb.halfWidth + COLLIDER_CLEARANCE,
      height + COLLIDER_CLEARANCE,
    ];
    let enter = -Infinity;
    let leave = Infinity;
    for (let axis = 0; axis < 3; axis++) {
      const o = origin[axis] as number;
      const d = step[axis] as number;
      const lo = low[axis] as number;
      const hi = high[axis] as number;
      if (Math.abs(d) < 1e-12) {
        if (o < lo || o > hi) leave = -Infinity;
        continue;
      }
      const a = (lo - o) / d;
      const b = (hi - o) / d;
      enter = Math.max(enter, Math.min(a, b));
      leave = Math.min(leave, Math.max(a, b));
    }
    if (enter > 0 && enter <= leave) nearest = Math.min(nearest, enter);
  }
  return nearest;
}

/**
 * Orbits the combination's centre, framed in the part of the pane the HUD leaves free: `view.panX` turns the camera around it
 * (counter-clockwise from above, radians, from the truck's heading), `view.panY` tilts it from the default pitch and `view.zoom`
 * divides the fitted distance, which stays within the bounding radius and the first collider on the way. `hold`, a
 * `ChaseArm`'s, carries that collider limit over from earlier frames.
 */
export function placeChaseCamera(
  camera: PerspectiveCamera,
  rig: ChaseRig,
  frame: ChaseFrame,
  view: TopDownView,
  hold?: (limit: number, open: number) => number,
): void {
  if (frame.width <= 0 || frame.height <= 0) return;
  const { centre, truck, face } = rig;
  const azimuth = truck.heading + CHASE_AZIMUTH.default + view.panX;
  const pitch = MathUtils.clamp(CHASE_PITCH.default + view.panY, CHASE_PITCH.min, CHASE_PITCH.max);
  const middle = aimHeight(face);
  const radius = boundingRadius(rig.extent);
  // A collider between the pivot and the eye would hide the vehicle: the eye stays in front of it, but never inside the bounding radius.
  const entry = firstEntry(
    rig,
    [centre.x, centre.y, middle],
    [Math.cos(pitch) * Math.cos(azimuth), Math.cos(pitch) * Math.sin(azimuth), Math.sin(pitch)],
  );
  const limit = Math.max(radius, Math.min(CHASE_MAX_DISTANCE, entry - ENTRY_GAP));
  const fitted = chaseDistance(rig.extent, face, frame);
  const zoom = MathUtils.clamp(view.zoom, CHASE_ZOOM.min, CHASE_ZOOM.max);
  const open = MathUtils.clamp(Math.max(fitted, fitted / zoom), radius, CHASE_MAX_DISTANCE);
  const reach = hold === undefined ? limit : hold(limit, open);
  const fit = Math.min(fitted, reach);
  const distance = MathUtils.clamp(fit / zoom, radius, reach);
  const horizontal = distance * Math.cos(pitch);
  const x = centre.x + horizontal * Math.cos(azimuth);
  const y = centre.y + horizontal * Math.sin(azimuth);
  aim.set(centre.x, middle, -centre.y);
  eye.set(x, Math.max(middle + distance * Math.sin(pitch), colliderTop(rig, x, y)), -y);
  camera.position.copy(eye);
  camera.lookAt(aim);
  frameCamera(camera, frame);
}

/** Sets the lens for `frame` and moves the aim from the pane's centre to the free rect's. */
function frameCamera(camera: PerspectiveCamera, frame: ChaseFrame): void {
  camera.fov = CHASE_FOV;
  camera.aspect = frameAspect(frame);
  const { clear } = frame;
  const shiftX = clear.x + clear.width / 2 - frame.width / 2;
  const shiftY = clear.y + clear.height / 2 - frame.height / 2;
  camera.setViewOffset(frame.width, frame.height, -shiftX, -shiftY, frame.width, frame.height);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

const look = new Vector3();

/**
 * Flies the camera from `pose`, framed as the orbit is. The pose is never changed: the eye is lifted
 * over a collider that stands where it is, so leaving the building lets it drop back.
 */
export function placeFreeCamera(
  camera: PerspectiveCamera,
  pose: FreePose,
  rig: ChaseRig,
  frame: ChaseFrame,
): void {
  if (frame.width <= 0 || frame.height <= 0) return;
  const lifted = Math.max(pose.z, colliderTop(rig, pose.x, pose.y));
  eye.set(pose.x, lifted, -pose.y);
  look.set(
    Math.cos(pose.pitch) * Math.cos(pose.yaw),
    Math.sin(pose.pitch),
    -Math.cos(pose.pitch) * Math.sin(pose.yaw),
  );
  camera.position.copy(eye);
  camera.lookAt(aim.copy(eye).add(look));
  frameCamera(camera, frame);
}

/** Where `camera` (placed by either function) is and looks, as a pose to continue from. */
export function cameraPose(camera: PerspectiveCamera): FreePose {
  camera.getWorldDirection(look);
  const { position } = camera;
  return poseFromGaze(
    { x: position.x, y: -position.z, z: position.y },
    { x: look.x, y: -look.z, z: look.y },
  );
}
