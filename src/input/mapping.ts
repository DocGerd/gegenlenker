import type { ControlVector, Gear } from '../contracts/sim';

export type InputState = {
  steer: number;
  lever: number;
  brake: boolean;
  gear: Gear;
  /** While set, the steer target ramps back to 0; wheel and steer-key input clear it. */
  resetting: boolean;
  /** Lamp switches: not part of the control vector, so the sim and the input log never see them. */
  lights: boolean;
  hazard: boolean;
};

export const LEVER_STEP = 0.1;
export const STEER_STEP = 0.1;
/** Lever travel per second while W/S/Up/Down is held, after `LEVER_HOLD_DELAY`. */
export const LEVER_RAMP_RATE = 0.5;
/** Hold time before the ramp starts, so a tap stays a single `LEVER_STEP`. */
export const LEVER_HOLD_DELAY = 0.25;
/** Half-sweep of the fixed arc: pointer angle is steer times this, so full lock reaches the end stops. */
export const POINTER_SWEEP_DEG = 75;
/** Wheel rotation within which the wheel reads as straight; it stays so until the larger bound. */
export const CENTRED_ENTER_DEG = 6;
export const CENTRED_LEAVE_DEG = 8;

export function createInputState(lights = false): InputState {
  return { steer: 0, lever: 0, brake: false, gear: 'P', resetting: false, lights, hazard: false };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function stepLever(s: InputState, direction: 1 | -1): void {
  s.lever = clamp(Math.round((s.lever + direction * LEVER_STEP) * 1000) / 1000, 0, 1);
}

/** Seconds of this frame that count toward the ramp, given the time already held before it. */
export const rampTime = (heldBefore: number, dt: number): number =>
  clamp(heldBefore + dt - LEVER_HOLD_DELAY, 0, dt);

/** Moves the lever by `LEVER_RAMP_RATE` per second for `seconds`; keeps the unrounded value. */
export function rampLever(s: InputState, direction: 1 | -1, seconds: number): void {
  s.lever = clamp(s.lever + direction * LEVER_RAMP_RATE * seconds, 0, 1);
}

/** One mouse-wheel notch on the steering wheel; positive is left. Cancels a pending centring. */
export function stepSteer(s: InputState, direction: 1 | -1): void {
  s.resetting = false;
  s.steer = clamp(Math.round((s.steer + direction * STEER_STEP) * 1000) / 1000, -1, 1);
}

/** Moves the steer target toward 0 by `rate` per second while a reset is pending. */
export function stepReset(s: InputState, rate: number, dt: number): void {
  if (!s.resetting) return;
  const step = rate * dt;
  if (Math.abs(s.steer) <= step) {
    s.steer = 0;
    s.resetting = false;
  } else {
    s.steer -= Math.sign(s.steer) * step;
  }
}

/** CSS rotation of the wheel rim; steer > 0 is left, which is counter-clockwise (negative). */
export const rimRotationDeg = (steer: number, lockToLockTurns: number): number =>
  -steer * lockToLockTurns * 180;

/** CSS rotation of the pointer on the fixed arc, same sign convention. */
export const pointerAngleDeg = (steer: number): number => -steer * POINTER_SWEEP_DEG;

/** Steer values at each whole turn of the wheel from straight, including 0. */
export function turnTicks(lockToLockTurns: number): number[] {
  const turns = Math.floor(lockToLockTurns / 2);
  return Array.from({ length: 2 * turns + 1 }, (_, i) => ((i - turns) * 2) / lockToLockTurns);
}

export type SteerDisplay = { pointerAngle: number; rimRotationDeg: number; centred: boolean };

/**
 * Both the target and the actual (rate-limited) steer must be inside the window, so the cue
 * never shows while the road wheels are still moving; `prevCentred` supplies the hysteresis.
 */
export function steerDisplay(
  steer: number,
  actualSteer: number,
  lockToLockTurns: number,
  prevCentred: boolean,
): SteerDisplay {
  const worst = Math.max(
    Math.abs(rimRotationDeg(steer, lockToLockTurns)),
    Math.abs(rimRotationDeg(actualSteer, lockToLockTurns)),
  );
  return {
    pointerAngle: pointerAngleDeg(steer),
    rimRotationDeg: rimRotationDeg(steer, lockToLockTurns),
    centred: worst < (prevCentred ? CENTRED_LEAVE_DEG : CENTRED_ENTER_DEG),
  };
}

export function toControlVector(s: InputState): ControlVector {
  return {
    steer: clamp(s.steer, -1, 1),
    lever: clamp(s.lever, 0, 1),
    brake: s.brake,
    gear: s.gear,
  };
}
