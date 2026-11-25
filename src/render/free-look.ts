import type { Rect2 } from '../contracts/layout';
import type { FreePose } from '../contracts/render';

// No `three` import: the input layer shares this math.

const rad = (degrees: number): number => (degrees * Math.PI) / 180;

/** Vertical field of view of the outside view's camera, degrees. */
export const FREE_FOV = 40;
/** Metres the free eye stays above the ground; a building under it lifts it further when placed. */
export const FREE_MIN_HEIGHT = 1.5;
/**
 * The highest the eye goes: from here over a corner of the layout bounds the skyline stays inside
 * the far plane (`chase-camera.test.ts` pins it).
 */
export const FREE_MAX_HEIGHT = 60;
export const FREE_PITCH = { min: rad(-85), max: rad(45) } as const;

/** Held-key turn and pitch rates, radians per second. */
const TURN_RATE = rad(60);
const PITCH_RATE = rad(40);
/** Held-key flight speed in metres per second: at least `FLY_MIN_SPEED`, rising with the height. */
const FLY_MIN_SPEED = 4;
const FLY_SPEED_PER_METRE = 0.8;
/** Height below which a pan or a gesture step scales as if from this height, metres. */
const SCALE_MIN_HEIGHT = 4;
/** Metres per unit of `ln(factor)` of a wheel notch, per metre of height. */
const WHEEL_GAIN = 2;
const PINCH_GAIN = 3;

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Which way each held key pushes: -1, 0 or 1. */
export type FreeInput = {
  /** Positive turns left. */
  readonly turn: number;
  /** Positive looks up. */
  readonly pitch: number;
  /** Positive flies forward along the gaze. */
  readonly fly: number;
};

export function clampFreePose(pose: FreePose, bounds: Rect2): FreePose {
  const turned = pose.yaw - TAU * Math.round(pose.yaw / TAU);
  return {
    x: clamp(pose.x, bounds.minX, bounds.maxX),
    y: clamp(pose.y, bounds.minY, bounds.maxY),
    z: clamp(pose.z, FREE_MIN_HEIGHT, FREE_MAX_HEIGHT),
    yaw: turned <= -Math.PI ? Math.PI : turned,
    pitch: clamp(pose.pitch, FREE_PITCH.min, FREE_PITCH.max),
  };
}

export const sameFreePose = (a: FreePose, b: FreePose): boolean =>
  a.x === b.x && a.y === b.y && a.z === b.z && a.yaw === b.yaw && a.pitch === b.pitch;

/** The unit vector the pose looks along, sim plane with z up. */
function gaze({ yaw, pitch }: FreePose): readonly [number, number, number] {
  return [Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch)];
}

/** Turns the view as if dragging the scene, as `dragHead` does: right turns it left, down turns it up. */
export function lookBy(
  pose: FreePose,
  dx: number,
  dy: number,
  paneHeight: number,
  bounds: Rect2,
): FreePose {
  const perPx = rad(FREE_FOV) / paneHeight;
  return clampFreePose(
    { ...pose, yaw: pose.yaw + dx * perPx, pitch: pose.pitch + dy * perPx },
    bounds,
  );
}

/** Slides the eye so the scene follows the pointer: right moves it left, down moves it up. */
export function panBy(
  pose: FreePose,
  dx: number,
  dy: number,
  paneHeight: number,
  bounds: Rect2,
): FreePose {
  const perPx = (2 * Math.tan(rad(FREE_FOV / 2)) * Math.max(pose.z, SCALE_MIN_HEIGHT)) / paneHeight;
  // the camera's right in the sim plane
  const rightX = Math.sin(pose.yaw);
  const rightY = -Math.cos(pose.yaw);
  return clampFreePose(
    {
      ...pose,
      x: pose.x - dx * perPx * rightX,
      y: pose.y - dx * perPx * rightY,
      z: pose.z + dy * perPx,
    },
    bounds,
  );
}

/** Moves the eye `distance` metres along the gaze; negative goes back. */
export function flyBy(pose: FreePose, distance: number, bounds: Rect2): FreePose {
  const [gx, gy, gz] = gaze(pose);
  return clampFreePose(
    { ...pose, x: pose.x + gx * distance, y: pose.y + gy * distance, z: pose.z + gz * distance },
    bounds,
  );
}

/** One frame of `seconds` with the held keys; frame-rate independent apart from the height-scaled speed. */
export function flyStep(
  pose: FreePose,
  input: FreeInput,
  seconds: number,
  bounds: Rect2,
): FreePose {
  if (seconds <= 0 || (input.turn === 0 && input.pitch === 0 && input.fly === 0)) return pose;
  const turned = {
    ...pose,
    yaw: pose.yaw + input.turn * TURN_RATE * seconds,
    pitch: pose.pitch + input.pitch * PITCH_RATE * seconds,
  };
  const speed = Math.max(FLY_MIN_SPEED, FLY_SPEED_PER_METRE * pose.z);
  return flyBy(clampFreePose(turned, bounds), input.fly * speed * seconds, bounds);
}

/** `factor` is a wheel notch as `wheelFactor` reads it: above 1 flies forward. */
export function wheelFly(pose: FreePose, factor: number, bounds: Rect2): FreePose {
  return flyBy(pose, Math.log(factor) * WHEEL_GAIN * Math.max(pose.z, SCALE_MIN_HEIGHT), bounds);
}

/** `ratio` is the new finger distance over the old: spreading flies forward. */
export function pinchFly(pose: FreePose, ratio: number, bounds: Rect2): FreePose {
  return flyBy(pose, Math.log(ratio) * PINCH_GAIN * Math.max(pose.z, SCALE_MIN_HEIGHT), bounds);
}

/** The pose of an eye at `eye` looking along `direction` (sim plane, z up), which need not be a unit vector; not clamped. */
export function poseFromGaze(
  eye: { readonly x: number; readonly y: number; readonly z: number },
  direction: { readonly x: number; readonly y: number; readonly z: number },
): FreePose {
  const length = Math.hypot(direction.x, direction.y, direction.z);
  return {
    x: eye.x,
    y: eye.y,
    z: eye.z,
    yaw: Math.atan2(direction.y, direction.x),
    pitch: length === 0 ? 0 : Math.asin(clamp(direction.z / length, -1, 1)),
  };
}
