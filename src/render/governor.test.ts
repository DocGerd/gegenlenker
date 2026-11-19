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

    it('ignores the frames right after a step up while the canvas reallocates', () => {
      const { timer, end } = slowedTimer();
      let now = end;
      while (timer.scale() < 1) {
        now += 1000 / 90;
        timer.frame(now);
      }
      for (const ms of [100, 100, 100, 25, 25, 25, 25]) {
        now += ms;
        timer.frame(now);
      }
      run(timer, 90, 60, now);
      expect(timer.scale()).toBe(1);
    });

    it('climbs back from the floor one step at a time', () => {
      const timer = createFrameTimer();
      const { end } = run(timer, 40, 1000);
      expect(timer.scale()).toBe(0.5);
      const seen = [timer.scale()];
      let now = end;
      for (let i = 0; i < 4000; i++) {
        now += 1000 / 90;
        timer.frame(now);
        if (timer.scale() !== seen.at(-1)) seen.push(timer.scale());
      }
      expect(seen).toHaveLength(5);
      expect(seen.at(-1)).toBe(1);
    });

    it('forgets a grown hold after a long healthy stretch', () => {
      const { timer, end } = slowedTimer();
      const { end: up } = run(timer, 90, 500, end);
      expect(timer.scale()).toBe(1);
      const { end: slow } = run(timer, 40, 8, up);
      expect(timer.scale()).toBeCloseTo(0.85, 10);
      const { end: calm } = run(timer, 90, 2000, slow);
      expect(timer.scale()).toBe(1);
      const { end: burst } = run(timer, 40, 8, calm);
      expect(timer.scale()).toBeCloseTo(0.85, 10);
      run(timer, 90, 500, burst);
      expect(timer.scale()).toBe(1);
    });

    it('does not grow the hold on slow windows that change nothing at the floor', () => {
      const timer = createFrameTimer();
      let now = run(timer, 40, 1000).end;
      expect(timer.scale()).toBe(0.5);
      while (timer.scale() === 0.5) {
        now += 1000 / 90;
        timer.frame(now);
      }
      now = run(timer, 40, 400, now).end;
      expect(timer.scale()).toBe(0.5);
      run(timer, 90, 1080, now);
      expect(timer.scale()).toBeGreaterThan(0.5);
    });
  });

  describe('a device that cannot sustain full resolution', () => {
    /** Frame cost depends on the scale in use, like a fill-rate-bound GPU. */
    function drive(timer: Timer, costMs: (scale: number) => number, seconds: number, start = 1000) {
      let now = start;
      const scales: number[] = [timer.scale()];
      while (now - start < seconds * 1000) {
        now += Math.max(costMs(timer.scale()), 1000 / 60);
        timer.frame(now);
        if (timer.scale() !== scales.at(-1)) scales.push(timer.scale());
      }
      return { end: now, scales };
    }
    const cannotHoldFull = (scale: number): number => (scale >= 1 ? 22 : 8);
    const probes = (scales: number[]): number => scales.slice(1).filter((s) => s === 1).length;

    it('probes full resolution at most twice, then stays put', () => {
      const timer = createFrameTimer();
      const { scales } = drive(timer, cannotHoldFull, 600);
      expect(probes(scales)).toBe(2);
      expect(timer.scale()).toBeCloseTo(0.85, 10);
    });

    it('probes again after the scene is replaced', () => {
      const timer = createFrameTimer();
      const { end } = drive(timer, cannotHoldFull, 600);
      timer.resetTiming();
      timer.resetScale();
      const { scales } = drive(timer, cannotHoldFull, 600, end + 1000);
      expect(probes(scales)).toBe(2);
    });

    it('remembers failed probes across a timing reset', () => {
      const timer = createFrameTimer();
      const { end } = drive(timer, cannotHoldFull, 600);
      timer.resetTiming();
      const { scales } = drive(timer, cannotHoldFull, 600, end + 1000);
      expect(probes(scales)).toBe(0);
    });

    it('keeps full resolution once a probe holds', () => {
      const timer = createFrameTimer();
      const { end } = drive(timer, (scale) => (scale >= 1 ? 22 : 8), 10);
      drive(timer, () => 8, 60, end);
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
      const { end: hitch } = run(timer, 40, 40, end);
      run(timer, 90, 100, hitch);
      expect(timer.scale()).toBe(1);
    });

    it('discards the window in progress', () => {
      const timer = createFrameTimer();
      const { end } = run(timer, 40, 59);
      timer.warmUp();
      run(timer, 90, 300, end);
      expect(timer.scale()).toBe(1);
    });

    it('governs again once the grace has passed', () => {
      const timer = createFrameTimer();
      const { end } = run(timer, 90, 100);
      timer.warmUp();
      run(timer, 40, 200, end);
      expect(timer.scale()).toBeLessThan(1);
    });

    it('starts the grace at the next frame, however long the attach blocked', () => {
      const timer = createFrameTimer();
      const { end } = run(timer, 90, 100);
      timer.warmUp();
      run(timer, 40, 70, end + 3000);
      expect(timer.scale()).toBe(1);
    });

    it('extends the grace on a repeated warmUp, never shortens it', () => {
      const timer = createFrameTimer();
      const { end } = run(timer, 90, 100);
      timer.warmUp();
      const { end: mid } = run(timer, 90, 135, end);
      timer.warmUp();
      run(timer, 40, 70, mid);
      expect(timer.scale()).toBe(1);
      run(timer, 40, 200, mid + 3000);
      expect(timer.scale()).toBeLessThan(1);
    });

    it('does not let an interrupted window count towards a step up', () => {
      const timer = createFrameTimer();
      const { end } = run(timer, 40, 61);
      const { end: mid } = run(timer, 90, 270, end);
      timer.warmUp();
      const { end: after } = run(timer, 90, 495, mid);
      expect(timer.scale()).toBeCloseTo(0.85, 10);
      run(timer, 90, 200, after);
      expect(timer.scale()).toBe(1);
    });

    it('ignores non-finite timestamps', () => {
      const timer = createFrameTimer();
      const { end } = run(timer, 90, 100);
      timer.frame(Number.NaN);
      run(timer, 90, 100, end);
      expect(timer.fps()).toBeCloseTo(90, 0);
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
