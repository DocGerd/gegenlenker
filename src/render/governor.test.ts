import { describe, expect, it } from 'vitest';
import { createFrameTimer, createResolutionGovernor } from './governor';

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

/** One display refresh at 60 Hz. */
const V = 1000 / 60;

/** Frame cost depends on the scale in use: `costMs` is what a frame takes at that scale. */
function drive(timer: Timer, costMs: (scale: number) => number, seconds: number, start = 1000) {
  let now = start;
  const scales: number[] = [timer.scale()];
  while (now - start < seconds * 1000) {
    now += Math.max(costMs(timer.scale()), V);
    timer.frame(now);
    if (timer.scale() !== scales.at(-1)) scales.push(timer.scale());
  }
  return { end: now, scales };
}

/** A seeded generator, so a random-miss run is the same every time. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Frames take `heavy` ms with probability `rate`, whatever the scale, like a CPU-bound load. */
function randomMisses(rate: number, seed: number, heavy = 2 * V): () => number {
  const next = seeded(seed);
  return () => (next() < rate ? heavy : V);
}

/** A fill-rate-bound GPU: the frame cost goes with the pixel count. */
const fillBound = (fullMs: number) => (scale: number) => fullMs * scale * scale;

const kinds = (timer: Timer): string[] => timer.trace().events.map((e) => e.kind);

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
  });

  it('steps down on sustained stalls longer than the gap limit', () => {
    const timer = createFrameTimer();
    drive(timer, fillBound(600), 120);
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
      // The settle frames and the window that keeps the step.
      const { end: kept } = run(timer, 90, 63, end);
      return { timer, end: kept };
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
      run(timer, 1000 / 19.2, 2000, end);
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
      const { end } = drive(timer, fillBound(80), 60);
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
      let now = drive(timer, fillBound(80), 60).end;
      expect(timer.scale()).toBe(0.5);
      while (timer.scale() === 0.5) {
        now += 1000 / 90;
        timer.frame(now);
      }
      now = drive(timer, fillBound(80), 10, now).end;
      expect(timer.scale()).toBe(0.5);
      run(timer, 90, 1080, now);
      expect(timer.scale()).toBeGreaterThan(0.5);
    });
  });

  describe('a device that cannot sustain full resolution', () => {
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

  describe('a load the scale cannot help', () => {
    describe('on random misses, over many seeds', () => {
      const SEEDS = 64;
      const SECONDS = 300;

      /** Each seed's lowest and last scale, with a resize warm-up every `warmEvery` s. */
      function sweep(rate: number, heavy: number, warmEvery: number) {
        return Array.from({ length: SEEDS }, (_, i) => {
          const timer = createFrameTimer();
          const cost = randomMisses(rate, i + 1, heavy);
          let now = 1000;
          let min = 1;
          for (let t = warmEvery; t <= SECONDS; t += warmEvery) {
            const leg = drive(timer, cost, warmEvery, now);
            now = leg.end;
            min = Math.min(min, ...leg.scales);
            if (t < SECONDS) timer.warmUp('resize');
          }
          return { min, end: timer.scale() };
        });
      }

      // A step kept by luck can lead to one more, reverted within seconds.
      it.each([
        [0.08, SECONDS],
        [0.08, 20],
        [0.12, SECONDS],
        [0.12, 20],
        [0.2, SECONDS],
        [0.2, 20],
      ])(
        'stays near full resolution on %d missed vsyncs, resizing every %i s',
        (rate, warmEvery) => {
          const runs = sweep(rate, 2 * V, warmEvery);
          expect(Math.min(...runs.map((r) => r.min))).toBeGreaterThan(0.69);
          expect(runs.filter((r) => r.min < 0.84).length).toBeLessThanOrEqual(4);
          expect(runs.filter((r) => r.end < 1).length).toBeLessThanOrEqual(2);
        },
      );

      it.each([SECONDS, 20])(
        'stays near full resolution on rare 80 ms stalls, resizing every %i s',
        (warmEvery) => {
          const runs = sweep(0.06, 5 * V, warmEvery);
          expect(Math.min(...runs.map((r) => r.min))).toBeGreaterThan(0.54);
          expect(runs.filter((r) => r.end < 0.84).length).toBeLessThanOrEqual(2);
          expect(runs.filter((r) => r.end < 1).length).toBeLessThanOrEqual(8);
        },
      );
    });

    describe('on a fill-bound load with random misses, not vsync-locked, over many seeds', () => {
      const SEEDS = 16;
      const SECONDS = 600;
      const SETTLED_MS = 60_000;

      it.each([
        [20, 0.1, 0.85],
        [28, 0.2, 0.7],
      ])('keeps the level that fits %i ms of fill with %d missed frames', (fullMs, rate, fits) => {
        const runs = Array.from({ length: SEEDS }, (_, i) => {
          const timer = createFrameTimer();
          const miss = seeded(i + 1);
          let now = 1000;
          let above = 0;
          while (now - 1000 < SECONDS * 1000) {
            // Unquantised: the fill time itself, one refresh longer on a miss.
            const ms = Math.max(fillBound(fullMs)(timer.scale()), V) + (miss() < rate ? V : 0);
            if (now - 1000 >= SETTLED_MS && timer.scale() > fits + 1e-9) above += ms;
            now += ms;
            timer.frame(now);
          }
          return { seed: i + 1, end: timer.scale(), above: above / (now - 1000 - SETTLED_MS) };
        });
        expect(runs.filter((r) => Math.abs(r.end - fits) > 1e-9 || r.above > 0.05)).toEqual([]);
      });

      it('leaves a level parked by chance for the kept step into it, on seeds that stayed high', () => {
        const runs = [512, 863].map((seed) => {
          const timer = createFrameTimer();
          const miss = seeded(seed);
          let now = 1000;
          let above = 0;
          while (now - 1000 < SECONDS * 1000) {
            const ms = Math.max(fillBound(28)(timer.scale()), V) + (miss() < 0.2 ? V : 0);
            if (now - 1000 >= SETTLED_MS && timer.scale() > 0.7 + 1e-9) above += ms;
            now += ms;
            timer.frame(now);
          }
          return { seed, end: timer.scale(), above: above / (now - 1000 - SETTLED_MS) };
        });
        expect(runs.filter((r) => Math.abs(r.end - 0.7) > 1e-9 || r.above > 0.05)).toEqual([]);
      });
    });

    it.each([
      [25, 6, 0.85],
      [36, 6, 0.7],
      [80, 40, 0.5],
    ])(
      'steps a fill-bound load of %i ms down to the level that fits, and recovers',
      (fullMs, seconds, fits) => {
        const timer = createFrameTimer();
        const { end } = drive(timer, fillBound(fullMs), seconds);
        expect(timer.scale()).toBeCloseTo(fits, 10);
        drive(timer, () => V, 120, end);
        expect(timer.scale()).toBe(1);
      },
    );

    it('lets a later fill-bound load step down after a burst the scale could not help', () => {
      const timer = createFrameTimer();
      const { end } = drive(timer, () => 2 * V, 6);
      expect(kinds(timer).filter((k) => k === 'down-failed')).toHaveLength(1);
      const { end: calm } = drive(timer, () => V, 10, end);
      drive(timer, fillBound(25), 6, calm);
      expect(timer.scale()).toBeCloseTo(0.85, 10);
    });

    it('keeps the level that fits a fill-bound load through a long burst the scale cannot help', () => {
      const timer = createFrameTimer();
      const { end } = drive(timer, fillBound(25), 30);
      expect(timer.scale()).toBeCloseTo(0.85, 10);
      const { end: burst } = drive(timer, () => 3 * V, 40, end);
      drive(timer, fillBound(25), 20, burst);
      expect(timer.scale()).toBeCloseTo(0.85, 10);
    });

    it('parks a level whose steps changed nothing until the preset or the lighting changes', () => {
      const timer = createFrameTimer();
      const { end } = drive(timer, () => 2 * V, 30);
      expect(kinds(timer).filter((k) => k === 'down-failed')).toHaveLength(3);
      const { end: parked } = drive(timer, fillBound(25), 20, end);
      expect(timer.scale()).toBe(1);
      timer.warmUp('resize');
      const { end: resized } = drive(timer, fillBound(25), 20, parked);
      expect(timer.scale()).toBe(1);
      timer.warmUp('lighting', { liftParks: true });
      drive(timer, fillBound(25), 6, resized);
      expect(timer.scale()).toBeCloseTo(0.85, 10);
    });

    it('undoes a kept step whose gain is gone, without parking its level', () => {
      const governor = createResolutionGovernor();
      const feed = (ms: number, n: number) => {
        for (let i = 0; i < n; i++) governor.sample(ms);
      };
      feed(25, 60);
      feed(V, 63);
      expect(governor.scale()).toBeCloseTo(0.85, 10);
      feed(25, 60);
      expect(governor.scale()).toBe(1);
      expect(governor.trace().events.map((e) => e.kind)).toEqual(['down', 'down-lost']);
      feed(25, 63);
      expect(governor.scale()).toBeCloseTo(0.85, 10);
    });

    it('leaves a level kept for a heavier load once a lighter load the scale cannot help replaces it', () => {
      const SEEDS = 20;
      const ends = Array.from({ length: SEEDS }, (_, i) => {
        const timer = createFrameTimer();
        const miss = seeded(i + 1);
        let now = 1000;
        while (now - 1000 < 600_000) {
          now += Math.max(fillBound(28)(timer.scale()), V) + (miss() < 0.2 ? V : 0);
          timer.frame(now);
        }
        expect(timer.scale()).toBeCloseTo(0.7, 10);
        drive(timer, randomMisses(0.35, i + 101), 1800, now);
        return { seed: i + 1, end: timer.scale() };
      });
      expect(ends.filter((r) => r.end !== 1)).toEqual([]);
    });

    it.each([
      [28, 0.2],
      [39, 0.1],
    ])(
      'changes the scale of a steady %i ms fill load with %d missed frames at most once a minute once settled',
      (fullMs, rate) => {
        const SEEDS = 8;
        const MINUTES = 60;
        const changes = Array.from({ length: SEEDS }, (_, i) => {
          const timer = createFrameTimer();
          const miss = seeded(i + 1);
          let now = 1000;
          let last = timer.scale();
          let n = 0;
          while (now - 1000 < MINUTES * 60_000) {
            now += Math.max(fillBound(fullMs)(timer.scale()), V) + (miss() < rate ? V : 0);
            timer.frame(now);
            if (now - 1000 > 60_000 && timer.scale() !== last) n++;
            last = timer.scale();
          }
          return n;
        });
        expect(Math.max(...changes)).toBeLessThan(MINUTES);
      },
    );

    it('keeps a steady fill-bound load off full resolution once settled, though its kept step gains little', () => {
      const SEEDS = 8;
      const runs = Array.from({ length: SEEDS }, (_, i) => {
        const timer = createFrameTimer();
        const miss = seeded(i + 1);
        let now = 1000;
        let max = 0;
        while (now - 1000 < 600_000) {
          now += Math.max(fillBound(39)(timer.scale()), V) + (miss() < 0.1 ? V : 0);
          timer.frame(now);
          if (now - 1000 > 120_000) max = Math.max(max, timer.scale());
        }
        return { seed: i + 1, max };
      });
      expect(runs.filter((r) => r.max === 1)).toEqual([]);
    });

    it('judges a heavier fill-bound load after a warm-up afresh', () => {
      const timer = createFrameTimer();
      const { end } = drive(timer, fillBound(25), 1.6);
      expect(timer.scale()).toBeCloseTo(0.85, 10);
      timer.warmUp('quality', { liftParks: true });
      drive(timer, fillBound(40), 60, end);
      expect(timer.scale()).toBeLessThan(0.85);
      expect(kinds(timer)).not.toContain('down-failed');
    });

    it('undoes a step a warm-up interrupted, so a load the scale cannot help stays at full resolution', () => {
      const timer = createFrameTimer();
      const { end } = drive(timer, () => 25, 2);
      expect(timer.scale()).toBeCloseTo(0.85, 10);
      timer.warmUp('attach:shells');
      drive(timer, () => 25, 30, end);
      expect(timer.scale()).toBe(1);
      expect(kinds(timer).filter((k) => k === 'down-failed')).toHaveLength(3);
      expect(kinds(timer).filter((k) => k === 'down')).toHaveLength(4);
    });

    /** `stalls` frames of 80 ms among healthy ones, then healthy frames only. */
    function stallWindow(stalls: number) {
      const governor = createResolutionGovernor();
      const window = new Array<number>(60).fill(V);
      for (let i = 0; i < stalls; i++) window[i * 8] = 80;
      for (const ms of window) governor.sample(ms);
      return governor;
    }

    it('does not step down on 6 stalls in a window', () => {
      const governor = stallWindow(6);
      expect(governor.scale()).toBe(1);
      expect(governor.trace().events).toEqual([]);
    });

    it('steps down once on 7 stalls in a window, then recovers', () => {
      const governor = stallWindow(7);
      expect(governor.scale()).toBeCloseTo(0.85, 10);
      for (let i = 0; i < 700; i++) governor.sample(V);
      expect(governor.scale()).toBe(1);
      expect(governor.trace().events.map((e) => e.kind)).toEqual(['down', 'up', 'probe-held']);
    });
  });

  describe('warm-up', () => {
    it('ignores slow frames right after a reset, then governs again', () => {
      const timer = createFrameTimer();
      timer.resetTiming();
      const { end } = run(timer, 40, 60);
      expect(timer.scale()).toBe(1);
      drive(timer, fillBound(25), 4, end);
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
      drive(timer, fillBound(25), 4, end);
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
      drive(timer, fillBound(25), 4, mid + 3000);
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

  describe('trace', () => {
    const cost = (scale: number): number => (scale >= 1 ? 22 : 8);
    function driveSlowFull(timer: Timer, seconds: number, start = 1000) {
      let now = start;
      while (now - start < seconds * 1000) {
        now += Math.max(cost(timer.scale()), 1000 / 60);
        timer.frame(now);
      }
      return now;
    }

    it('records a probe that cannot hold, twice, then nothing', () => {
      const timer = createFrameTimer();
      driveSlowFull(timer, 600);
      const { events } = timer.trace();
      expect(events.map((e) => e.kind)).toEqual([
        'down',
        'up',
        'probe-failed',
        'up',
        'probe-failed',
      ]);
      expect(events.map((e) => e.level)).toEqual([1, 0, 1, 0, 1]);
      expect(events.map((e) => e.failedProbes)).toEqual([0, 0, 1, 1, 2]);
      expect(events.map((e) => e.hold)).toEqual([4000, 4000, 8000, 8000, 16000]);
      for (const e of events) expect(e.p90).toBeGreaterThan(0);
      expect(events.filter((e) => e.kind === 'up').every((e) => e.steady >= 4000)).toBe(true);
    });

    it('records each step down that did not help, until its level is parked', () => {
      const governor = createResolutionGovernor();
      for (let i = 0; i < 600; i++) governor.sample(40);
      const attempt = [
        ['down', 1],
        ['down-failed', 0],
      ];
      expect(governor.trace().events.map((e) => [e.kind, e.level])).toEqual([
        ...attempt,
        ...attempt,
        ...attempt,
      ]);
      expect(governor.scale()).toBe(1);
    });

    it('records a probe that holds', () => {
      const timer = createFrameTimer();
      const end = driveSlowFull(timer, 10);
      run(timer, 90, 6000, end);
      expect(timer.trace().events.map((e) => e.kind)).toEqual([
        'down',
        'up',
        'probe-failed',
        'up',
        'probe-held',
      ]);
      expect(timer.scale()).toBe(1);
    });

    it('names what caused a warm-up and what it discarded', () => {
      const timer = createFrameTimer();
      const { end } = run(timer, 40, 30);
      timer.warmUp('resize');
      timer.warmUp();
      const { events } = timer.trace();
      expect(events.map((e) => [e.kind, e.tag])).toEqual([
        ['warmup', 'resize'],
        ['discard', 'resize'],
        ['warmup', ''],
      ]);
      expect(events[0]?.t).toBe(end);
    });

    it('records a scene change with the state it replaced, then the state after', () => {
      const timer = createFrameTimer();
      const end = driveSlowFull(timer, 600);
      const before = timer.trace().events.length;
      timer.resetScale('scene');
      timer.resetTiming('scene');
      const [reset, restart, warm] = timer.trace().events.slice(before);
      expect([reset?.kind, restart?.kind, warm?.kind]).toEqual(['reset', 'restart', 'warmup']);
      expect([reset?.tag, restart?.tag, warm?.tag]).toEqual(['scene', 'scene', 'scene']);
      expect(reset).toMatchObject({ level: 1, hold: 16000, failedProbes: 2 });
      expect(warm).toMatchObject({ level: 0, hold: 4000, failedProbes: 0 });
      expect(reset?.t).toBe(end);
    });

    it('keeps the newest events and intervals within fixed bounds', () => {
      const timer = createFrameTimer();
      // The cadence alternates so the order of the intervals is observable.
      let now = 1000;
      const frames = 9000;
      for (let i = 0; i < frames; i++) {
        now += i % 2 === 0 ? 10 : 12;
        timer.frame(now);
      }
      for (let i = 0; i < 1000; i++) timer.warmUp(String(i));
      const trace = timer.trace();
      // The first frame only sets the previous timestamp.
      const fed = frames - 1;
      expect(trace.dropped).toBe(fed - 8192);
      expect(trace.intervals).toEqual(
        Array.from({ length: 8192 }, (_, k) => ((trace.dropped + k) % 2 === 0 ? 12 : 10)),
      );
      expect(trace.events).toHaveLength(256);
      expect(trace.events.map((e) => e.tag)).toEqual(
        Array.from({ length: 256 }, (_, k) => String(744 + k)),
      );
    });

    it('keeps decisions when a burst of causes fills the ring', () => {
      const timer = createFrameTimer();
      driveSlowFull(timer, 600);
      for (let i = 0; i < 1000; i++) timer.warmUp('resize');
      const kinds = timer.trace().events.map((e) => e.kind);
      expect(kinds.filter((k) => k === 'down' || k === 'up' || k === 'probe-failed')).toHaveLength(
        5,
      );
      expect(kinds).toHaveLength(5 + 256);
    });
  });
});

describe('a 60 Hz cadence with frame jitter', () => {
  /** Frame intervals (0.1 ms) of one CPU-throttled 60 Hz run on a desktop GPU, with a few skipped vsyncs. */
  const JITTER = [
    '167 177 160 162 160 175 163 180 167 163 154 165 178 165 171 168 151 175 182 140 186 161 170',
    '156 181 158 165 179 146 200 156 163 158 163 157 181 166 158 162 184 151 186 150 180 154 185',
    '148 191 146 153 190 152 179 148 186 172 169 163 162 165 179 153 177 158 167 186 355 154 140',
    '160 177 153 183 162 159 176 154 170 177 176 160 165 143 190 158 172 166 155 172 176 173 149',
    '176 163 184 154 160 166 162 184 158 149 187 161 173 171 154 174 174 175 163 158 171 153 161',
    '182 161 169 168 160 171 158 181 162 164 169 165 183 149 171 154 181 157 176 166 164 149 190',
    '156 173 161 163 177 156 180 156 188 154 161 155 192 149 177 169 160 176 151 185 157 159 169',
    '169 173 170 167 154 167 163 171 170 157 177 170 170 169 160 162 161 159 187 159 162 167 159',
    '172 180 165 167 154 170 154 181 167 164 174 142 179 180 170 177 165 150 177 159 175 139 176',
    '174 182 162 171 161 165 163 165 164 177 152 182 168 171 144 175 174 166 165 179 133 174 180',
    '157 177 167 164 162 161 170 178 163 171 170 155 169 170 166 175 166 157 151 178 181 171 159',
    '157 176 175 171 152 157 184 170 150 169 173 168 151 178 159 185 149 169 174 154 182 172 152',
    '171 167 163 164 171 158 172 162 165 187 150 181 159 166 168 173 148 172 174 159 178 166 173',
    '157 164 164 152 192 164 175 159 168 166 154 176 167 163 183 152 156 170 170 173 185 145 160',
    '174 159 184 151 159 185 174 155 166 158 193 162 159 158 164 168 166 162 196 148 184 147 171',
    '163 156 170 178 174 154 175 155 184 148 180 151 186 169 164 173 162 158 168 167 172 162 157',
    '188 155 159 180 172 162 145 179 185 140 174 174 164 171 161 160 188 138 181 172 156 173 179',
    '149 181 175 135 189 158 173 173 159 164 163 163 170 177 155 165 184 167 156 163 167 166 161',
    '177 159 176 182 140 177 159 172 154 175 162 179 139 188 166 167 158 175 173 164 163 173 156',
    '164 169 173 170 162 162 167 164 167 162 166 189 153 164 169 175 173 164 157 167 166 165 184',
    '153 164 166 163 177 168 152 176 166 174 173 161 165 165 168 158 179 160 175 153 170 172 155',
    '178 188 152 162 167 157 176 176 153 170 164 145 196 170 151 183 155 163 177 156 170 174 148',
    '190 165 163 159 166 161 181 175 163 155 185 143 164 185 162 174 174 139 188 144 189 150 191',
    '140 172 168 186 241 99 145 172 155 169 168 162 180 169 174 144 166 169 173 170 165 170 166',
    '170 159 154 175 164 171 171 173 157 158 176 172 159 167 181 163 153 168 163 173 164 179 163',
    '161 176 153 176 163 157 174 184 156 148 183 162 158 196 150 159 182 163 151 175 176 159 164',
    '174 165 173 156 170 167 158 167 166 178 157 171 180 154 165 171 186 147 169 154 176 172 162',
    '172 170 155 167 162 172 169 176 169 159 155 164 182 161 162 178 160 172 173 155 153 192 162',
    '157 169 155 182 167 175 159 155 167 176 171 162 167 166 174 163 170 153 173 179 147 169 179',
    '159 182 153 169 148 186 156 189 147 167 160 187 152 160 188 146 174 171 164 168 165 158 168',
    '180 155 165 183 173 152 168 196 132 177 176 166 144 180 163 175 161 161 172 178 150 174 161',
    '166 180 161 151 190 148 172 165 166 168 168 175 153 182 162 156 192 271 111 111 153 164 181',
    '159 150 188 162 163 168 174 148 180 176 152 155 185 164 150 182 161 196 138 173 163 176 164',
    '172 168 151 175 162 167 160 177 176 153 168 166 183 158 162 168 171 162 159 172 165 164 177',
    '163 172 157 174 164 164 167 172 164 162 180 161 157 174 163 151 201 153 165 169 152 182',
  ]
    .join(' ')
    .split(' ')
    .map((tenths) => Number(tenths) / 10);

  function feed(governor: ReturnType<typeof createResolutionGovernor>, intervals: number[]) {
    for (const ms of intervals) governor.sample(ms);
  }

  it('does not step down on jitter alone', () => {
    const governor = createResolutionGovernor();
    feed(governor, JITTER);
    expect(governor.scale()).toBe(1);
    expect(governor.trace().events.filter((e) => e.kind === 'down')).toHaveLength(0);
  });

  it('climbs back to full resolution after a real stall', () => {
    const governor = createResolutionGovernor();
    feed(governor, new Array<number>(60).fill(40));
    expect(governor.scale()).toBeCloseTo(0.85, 10);
    feed(governor, JITTER);
    expect(governor.scale()).toBe(1);
  });

  it('steps down when the same jitter runs 1.5 ms slower', () => {
    const governor = createResolutionGovernor();
    feed(
      governor,
      JITTER.map((ms) => ms + 1.5),
    );
    // The replay cannot respond to the scale, so every step is reverted after it.
    const attempt = ['down', 'down-failed'];
    expect(governor.trace().events.map((e) => e.kind)).toEqual([
      ...attempt,
      ...attempt,
      ...attempt,
    ]);
    expect(governor.scale()).toBe(1);
  });

  it('keeps a step that brings the jitter 1.5 ms slower back on time', () => {
    const governor = createResolutionGovernor();
    for (let i = 0; i < 3 * JITTER.length; i++) {
      const ms = JITTER[i % JITTER.length] ?? 0;
      governor.sample(governor.scale() < 1 ? ms : ms + 1.5);
    }
    expect(governor.trace().events.map((e) => e.kind)).not.toContain('down-failed');
    expect(governor.scale()).toBeCloseTo(0.85, 10);
  });

  it.each([20, 21, 25])(
    'steps down and back three times, then stays, when every frame takes %ims at any scale',
    (ms) => {
      const governor = createResolutionGovernor();
      feed(governor, new Array<number>(600).fill(ms));
      const attempt = ['down', 'down-failed'];
      expect(governor.trace().events.map((e) => e.kind)).toEqual([
        ...attempt,
        ...attempt,
        ...attempt,
      ]);
      expect(governor.scale()).toBe(1);
    },
  );
});
