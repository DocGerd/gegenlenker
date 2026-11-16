import type { ControlVector, Gear } from '../contracts/sim';

export type InputState = { steer: number; lever: number; brake: boolean; gear: Gear };

export const LEVER_STEP = 0.1;

export function createInputState(): InputState {
  return { steer: 0, lever: 0, brake: false, gear: 'P' };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function stepLever(s: InputState, direction: 1 | -1): void {
  s.lever = clamp(Math.round((s.lever + direction * LEVER_STEP) * 1000) / 1000, 0, 1);
}

export function pressBrake(s: InputState): void {
  s.lever = 0;
  s.brake = true;
}

export function toControlVector(s: InputState): ControlVector {
  return {
    steer: clamp(s.steer, -1, 1),
    lever: clamp(s.lever, 0, 1),
    brake: s.brake,
    gear: s.gear,
  };
}
