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
  /** Frame intervals (0.1 ms) of a 60 Hz display under CPU throttling: median 16.7 ms, no frame is late. */
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

  it.each([20, 21, 25])('steps down when every frame takes %ims', (ms) => {
    const governor = createResolutionGovernor();
    feed(governor, new Array<number>(120).fill(ms));
    expect(governor.scale()).toBeLessThan(1);
  });
});
