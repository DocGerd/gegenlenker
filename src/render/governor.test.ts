import { describe, expect, it } from 'vitest';
import { DT } from '../sim/constants';
import { createFrameTimer } from './governor';

type Timer = ReturnType<typeof createFrameTimer>;

/**
 * One animation-frame callback per display refresh; the app draws only when a 60 Hz step ran.
 * `drawnOnly` feeds the timer just those draws, as the renderer did before `skipFrame`.
 */
function run(timer: Timer, hz: number, frames: number, start = 1000, drawnOnly = false) {
  const period = 1000 / hz;
  let accumulator = 0;
  let now = start;
  for (let i = 0; i < frames; i++) {
    now += period;
    accumulator += period / 1000;
    const steps = Math.floor(accumulator / DT + 1e-9);
    accumulator -= steps * DT;
    if (steps > 0 || !drawnOnly) timer.frame(now);
  }
  return { end: now };
}

describe('frame timer', () => {
  it('reads draws alone at 90 Hz as overload, which is why skipped frames are reported', () => {
    const timer = createFrameTimer();
    run(timer, 90, 600, 1000, true);
    expect(timer.scale()).toBeLessThan(1);
  });

  it.each([72, 90, 144])('keeps full resolution at a healthy %i Hz cadence', (hz) => {
    const timer = createFrameTimer();
    run(timer, hz, 600);
    expect(timer.scale()).toBe(1);
    expect(timer.fps()).toBeCloseTo(hz, 0);
    expect(timer.p95Ms()).toBeCloseTo(1000 / hz, 1);
  });

  it('steps the resolution down when callbacks are genuinely slow', () => {
    const timer = createFrameTimer();
    run(timer, 40, 61);
    expect(timer.scale()).toBeCloseTo(0.85, 10);
    run(timer, 40, 1000);
    expect(timer.scale()).toBe(0.5);
  });

  it('does not count a pause as slow once timing is reset', () => {
    const timer = createFrameTimer();
    const { end } = run(timer, 90, 200);
    timer.resetTiming();
    run(timer, 90, 30, end + 5000);
    expect(timer.scale()).toBe(1);
    expect(timer.fps()).toBeCloseTo(90, 0);
    expect(timer.p95Ms()).toBeCloseTo(1000 / 90, 1);
  });

  it('does not count a long gap as slow even without a reset', () => {
    const timer = createFrameTimer();
    const { end } = run(timer, 90, 200);
    run(timer, 90, 30, end + 5000);
    expect(timer.scale()).toBe(1);
    expect(timer.fps()).toBeCloseTo(90, 0);
    expect(timer.p95Ms()).toBeCloseTo(1000 / 90, 1);
  });
});
