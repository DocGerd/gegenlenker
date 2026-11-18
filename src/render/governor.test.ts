import { describe, expect, it } from 'vitest';
import { createFrameTimer } from './governor';

type Timer = ReturnType<typeof createFrameTimer>;

/** One animation-frame callback per display refresh. */
function run(timer: Timer, hz: number, frames: number, start = 1000) {
  const period = 1000 / hz;
  let now = start;
  for (let i = 0; i < frames; i++) {
    now += period;
    timer.frame(now);
  }
  return { end: now };
}

describe('frame timer', () => {
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

  it('steps down on sustained stalls longer than the gap limit', () => {
    const timer = createFrameTimer();
    run(timer, 1000 / 600, 200);
    expect(timer.scale()).toBeLessThan(1);
  });

  it('does not count a pause as slow once timing is reset', () => {
    const timer = createFrameTimer();
    const { end } = run(timer, 90, 200);
    timer.resetTiming();
    run(timer, 90, 30, end + 300);
    expect(timer.scale()).toBe(1);
    expect(timer.fps()).toBeCloseTo(90, 0);
    expect(timer.p95Ms()).toBeCloseTo(1000 / 90, 1);
  });

  it('ignores a single gap just over the limit between healthy frames', () => {
    const timer = createFrameTimer();
    const { end } = run(timer, 90, 200);
    run(timer, 90, 30, end + 500);
    expect(timer.scale()).toBe(1);
    expect(timer.fps()).toBeCloseTo(90, 0);
    expect(timer.p95Ms()).toBeCloseTo(1000 / 90, 1);
  });

  describe('stepping back up', () => {
    function slowedTimer() {
      const timer = createFrameTimer();
      const { end } = run(timer, 40, 61);
      expect(timer.scale()).toBeCloseTo(0.85, 10);
      return { timer, end };
    }

    it('restores full resolution after sustained headroom, and not before', () => {
      const { timer, end } = slowedTimer();
      const { end: mid } = run(timer, 90, 180, end);
      expect(timer.scale()).toBeCloseTo(0.85, 10);
      run(timer, 90, 500, mid);
      expect(timer.scale()).toBe(1);
    });

    it('holds the scale while frames sit between the step-up and step-down limits', () => {
      const { timer, end } = slowedTimer();
      run(timer, 1000 / 18.2, 2000, end);
      expect(timer.scale()).toBeCloseTo(0.85, 10);
    });

    it('waits longer after a step up is followed by a step down', () => {
      const { timer, end } = slowedTimer();
      const { end: healthy } = run(timer, 90, 500, end);
      expect(timer.scale()).toBe(1);
      const { end: slow } = run(timer, 40, 8, healthy);
      expect(timer.scale()).toBeCloseTo(0.85, 10);
      // The first hold would have elapsed by now; the doubled one has not.
      const { end: short } = run(timer, 90, 500, slow);
      expect(timer.scale()).toBeCloseTo(0.85, 10);
      run(timer, 90, 500, short);
      expect(timer.scale()).toBe(1);
    });
  });

  describe('warm-up', () => {
    it('ignores slow frames right after a reset, then governs again', () => {
      const timer = createFrameTimer();
      timer.resetTiming();
      const { end } = run(timer, 40, 60);
      expect(timer.scale()).toBe(1);
      run(timer, 40, 200, end);
      expect(timer.scale()).toBeLessThan(1);
    });

    it('ignores a hitch after warmUp without dropping the scale', () => {
      const timer = createFrameTimer();
      const { end } = run(timer, 90, 100);
      timer.warmUp();
      run(timer, 1000 / 150, 10, end);
      run(timer, 90, 60, end + 1500);
      expect(timer.scale()).toBe(1);
    });

    it('still reports the real cadence while warming up', () => {
      const timer = createFrameTimer();
      timer.resetTiming();
      run(timer, 40, 30);
      expect(timer.fps()).toBeCloseTo(40, 0);
    });
  });
});
