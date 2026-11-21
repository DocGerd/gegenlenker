const WINDOW = 60;
const P90_LIMIT_MS = 18.5;
/** A window this fast counts towards stepping the scale back up; the gap to the limit is the hysteresis. */
const P90_HEADROOM_MS = 18;
const HOLD_MS = 4000;
const MAX_HOLD_MS = 32000;
/** A step up that is reverted within its hold is a failed probe; a level probed this often is left alone. */
const MAX_FAILED_PROBES = 2;
/** Frames ignored after a step up: the canvas reallocates and the first frames at the new size hitch. */
const SETTLE_FRAMES = 3;
/** Startup hitches (shader links, texture uploads) follow a scene or an attach; they say nothing about steady load. */
const WARM_UP_MS = 2000;
const STEP = 0.15;
const FLOOR = 0.5;
const MAX_LEVEL = Math.ceil((1 - FLOOR) / STEP);
const EMA_SMOOTHING = 0.1;
const P95_WINDOW = 120;
// An isolated interval this long is a pause or hidden tab; a run of them is real load.
const MAX_GAP_MS = 500;

const EVENT_CAP = 256;
const INTERVAL_CAP = 8192;

export type GovernorEventKind =
  'down' | 'up' | 'probe-failed' | 'probe-held' | 'warmup' | 'discard';
const KINDS: readonly GovernorEventKind[] = [
  'down',
  'up',
  'probe-failed',
  'probe-held',
  'warmup',
  'discard',
];

export type GovernorEvent = {
  kind: GovernorEventKind;
  /** What caused a `warmup` or `discard`: `init`, `scene`, `quality`, `lighting`, `resize`, `attach:<key>`. */
  tag: string;
  /** Timestamp of the last frame seen, on the `performance.now()` clock. */
  t: number;
  /** Samples the governor had taken when the event happened; indexes `intervals` (offset by `dropped`). */
  sample: number;
  level: number;
  /** The last window's p90 in ms; 0 before the first window. */
  p90: number;
  hold: number;
  /** Failed probes of the more demanding level in the transition; of the current level for the other kinds. */
  failedProbes: number;
  /** ms of headroom accumulated towards a step up when the event happened. */
  steady: number;
};

export type GovernorTrace = {
  events: GovernorEvent[];
  /** The frame intervals the governor was fed, oldest first. */
  intervals: number[];
  /** Intervals fed before the oldest one kept. */
  dropped: number;
};

/** Bounded rings written without allocating; `read` copies them out. */
function createTrace() {
  const kind = new Uint8Array(EVENT_CAP);
  const tag: string[] = new Array<string>(EVENT_CAP).fill('');
  const time = new Float64Array(EVENT_CAP);
  const sampleAt = new Float64Array(EVENT_CAP);
  const level = new Uint8Array(EVENT_CAP);
  const p90 = new Float32Array(EVENT_CAP);
  const hold = new Float32Array(EVENT_CAP);
  const failed = new Uint8Array(EVENT_CAP);
  const steady = new Float32Array(EVENT_CAP);
  const intervals = new Float32Array(INTERVAL_CAP);
  let events = 0;
  let samples = 0;
  let now = 0;
  return {
    setTime(t: number): void {
      now = t;
    },
    interval(ms: number): void {
      intervals[samples % INTERVAL_CAP] = ms;
      samples++;
    },
    event(
      k: GovernorEventKind,
      label: string,
      state: { level: number; p90: number; hold: number; failedProbes: number; steady: number },
    ): void {
      const i = events % EVENT_CAP;
      kind[i] = KINDS.indexOf(k);
      tag[i] = label;
      time[i] = now;
      sampleAt[i] = samples;
      level[i] = state.level;
      p90[i] = state.p90;
      hold[i] = state.hold;
      failed[i] = state.failedProbes;
      steady[i] = state.steady;
      events++;
    },
    read(): GovernorTrace {
      const out: GovernorEvent[] = [];
      for (let n = Math.max(0, events - EVENT_CAP); n < events; n++) {
        const i = n % EVENT_CAP;
        out.push({
          kind: KINDS[kind[i] ?? 0] ?? 'down',
          tag: tag[i] ?? '',
          t: time[i] ?? 0,
          sample: sampleAt[i] ?? 0,
          level: level[i] ?? 0,
          p90: p90[i] ?? 0,
          hold: hold[i] ?? 0,
          failedProbes: failed[i] ?? 0,
          steady: steady[i] ?? 0,
        });
      }
      const dropped = Math.max(0, samples - INTERVAL_CAP);
      const kept: number[] = [];
      for (let n = dropped; n < samples; n++) kept.push(intervals[n % INTERVAL_CAP] ?? 0);
      return { events: out, intervals: kept, dropped };
    },
  };
}

type Trace = ReturnType<typeof createTrace>;

export function createResolutionGovernor(trace: Trace = createTrace()): {
  sample(frameMs: number): number;
  /** Drops the samples of the window in progress, keeping the scale. `tag` names the cause in the trace. */
  discardWindow: (tag?: string) => void;
  /** Back to full resolution, remembering the hold and the failed probes. */
  restart: () => void;
  /** Back to full resolution and forgets everything learnt about the device. */
  reset: () => void;
  scale: () => number;
  trace: () => GovernorTrace;
} {
  let level = 0;
  let count = 0;
  let next = 0;
  let steady = 0;
  let sinceUp = Infinity;
  let hold = HOLD_MS;
  let probing = false;
  let settle = 0;
  let lastP90 = 0;
  const failedProbes = new Uint8Array(MAX_LEVEL + 1);
  const ring = new Float64Array(WINDOW);
  const scratch = new Float64Array(WINDOW);
  const scale = (): number => Math.max(FLOOR, 1 - level * STEP);
  const restart = (): void => {
    level = 0;
    count = 0;
    steady = 0;
    sinceUp = Infinity;
    probing = false;
    settle = 0;
  };
  const note = (k: GovernorEventKind, tag: string, failedLevel = level, held = steady): void => {
    trace.event(k, tag, {
      level,
      p90: lastP90,
      hold,
      failedProbes: failedProbes[failedLevel] ?? 0,
      steady: held,
    });
  };
  return {
    sample(frameMs) {
      trace.interval(frameMs);
      sinceUp += frameMs;
      if (probing && sinceUp >= hold) {
        probing = false;
        failedProbes[level] = 0;
        hold = HOLD_MS;
        note('probe-held', '');
      }
      if (settle > 0) {
        settle--;
        return scale();
      }
      ring[next] = frameMs;
      next = (next + 1) % WINDOW;
      if (count < WINDOW) count++;
      if (count < WINDOW) return scale();
      scratch.set(ring);
      scratch.sort();
      const p90 = scratch[Math.ceil(0.9 * WINDOW) - 1] ?? 0;
      lastP90 = p90;
      if (p90 > P90_LIMIT_MS) {
        if (level < MAX_LEVEL) {
          const failedProbe = probing;
          const left = level;
          if (failedProbe) {
            // The step up did not hold: the headroom was borrowed, so wait longer and count the failure.
            failedProbes[level] = (failedProbes[level] ?? 0) + 1;
            hold = Math.min(hold * 2, MAX_HOLD_MS);
          }
          level++;
          note(failedProbe ? 'probe-failed' : 'down', '', left);
        }
        probing = false;
        steady = 0;
        count = 0;
      } else if (
        level > 0 &&
        p90 <= P90_HEADROOM_MS &&
        (failedProbes[level - 1] ?? 0) < MAX_FAILED_PROBES
      ) {
        steady += frameMs;
        if (steady >= hold) {
          const held = steady;
          level--;
          steady = 0;
          sinceUp = 0;
          count = 0;
          probing = true;
          settle = SETTLE_FRAMES;
          note('up', '', level, held);
        }
      } else {
        steady = 0;
      }
      return scale();
    },
    discardWindow(tag = '') {
      note('warmup', tag);
      if (count > 0 || steady > 0) note('discard', tag);
      count = 0;
      steady = 0;
    },
    restart,
    reset() {
      restart();
      hold = HOLD_MS;
      failedProbes.fill(0);
    },
    scale,
    trace: () => trace.read(),
  };
}

/**
 * Times animation-frame callbacks, drawn or not: the app skips redundant draws, so only the callback
 * cadence says whether the browser keeps up.
 */
export function createFrameTimer(): {
  frame(now: number): void;
  resetTiming(tag?: string): void;
  /** Ignores the governor for a while: the next frames carry startup hitches, not steady load. */
  warmUp(tag?: string): void;
  resetScale(): void;
  scale: () => number;
  fps(): number;
  p95Ms(): number;
  /** What the governor did and the intervals it saw; copies the rings, so call it on demand. */
  trace: () => GovernorTrace;
} {
  const trace = createTrace();
  const governor = createResolutionGovernor(trace);
  const ring = new Float64Array(P95_WINDOW);
  const scratch = new Float64Array(P95_WINDOW);
  let last = -1;
  let longBefore = false;
  let graceEnd = 0;
  let graceFromNextFrame = false;
  let ema = 0;
  let count = 0;
  let next = 0;
  const warmUp = (tag?: string): void => {
    governor.discardWindow(tag);
    // Armed from the next frame: an attach can block the thread past any fixed grace.
    graceFromNextFrame = true;
    graceEnd = Infinity;
  };
  return {
    frame(now) {
      if (!Number.isFinite(now)) return;
      trace.setTime(now);
      if (graceFromNextFrame) {
        graceEnd = now + WARM_UP_MS;
        graceFromNextFrame = false;
      }
      const dt = now - last;
      const long = dt > MAX_GAP_MS;
      if (last >= 0 && (!long || longBefore)) {
        ema = ema === 0 ? dt : ema + EMA_SMOOTHING * (dt - ema);
        ring[next] = dt;
        next = (next + 1) % P95_WINDOW;
        if (count < P95_WINDOW) count++;
        if (now >= graceEnd) governor.sample(dt);
      }
      longBefore = last >= 0 && long;
      last = now;
    },
    /** Drops the previous timestamp too, so a gap (pause, hidden tab, new scene) is never sampled. */
    resetTiming(tag) {
      last = -1;
      longBefore = false;
      ema = 0;
      count = 0;
      next = 0;
      governor.restart();
      warmUp(tag);
    },
    warmUp,
    resetScale: governor.reset,
    scale: governor.scale,
    trace: governor.trace,
    fps: () => (ema === 0 ? 0 : 1000 / ema),
    p95Ms() {
      if (count === 0) return 0;
      const sorted = scratch.subarray(0, count);
      sorted.set(ring.subarray(0, count));
      sorted.sort();
      return sorted[Math.ceil(0.95 * count) - 1] ?? 0;
    },
  };
}
