import { DT, MAX_STEPS_PER_FRAME } from './constants';

/** Fixed-step accumulator; a long frame gap is clamped instead of replayed in full. */
export function advanceClock(
  accumulator: number,
  frameSeconds: number,
): { steps: number; accumulator: number } {
  const acc = accumulator + Math.min(frameSeconds, MAX_STEPS_PER_FRAME * DT);
  const steps = Math.floor(acc / DT + 1e-9);
  return { steps, accumulator: acc - steps * DT };
}
