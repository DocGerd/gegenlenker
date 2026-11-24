const WINDOW = 60;
/** Past this a window is slow: the limit sits above the p90 of an on-time but jittery 60 Hz cadence. */
const P90_LIMIT_MS = 19.5;
/** A window this fast counts towards stepping the scale back up; the gap to the limit is the hysteresis. */
const P90_HEADROOM_MS = 19;
const HOLD_MS = 4000;
const MAX_HOLD_MS = 32000;
/** A step up that is reverted within its hold is a failed probe; a level probed this often is left alone. */
const MAX_FAILED_PROBES = 2;
/** Frames ignored after a step up: the canvas reallocates and the first frames at the new size hitch. */
const SETTLE_FRAMES = 3;
/** A step down must cut the next window's mean interval by this share, or it is reverted: the load ignores the scale. */
const MIN_IMPROVEMENT = 0.1;
/**
 * A window whose mean sits within this share of its median is slowed by a shift, not by missed frames. Near vsync a
 * fill-bound step from such a window cannot cut the mean by `MIN_IMPROVEMENT`, so it is kept when the next window is
 * on time, shifted too and `SHIFT_IMPROVEMENT` faster.
 */
const SHIFT_SLACK = 0.05;
const SHIFT_IMPROVEMENT = 0.05;
/**
 * A level whose step down was reverted this often is parked until the preset, the lighting or the scene changes. A load
 * that ramps up can cost one: its first step is judged against a window still mostly of the old load.
 */
const MAX_FAILED_DOWNS = 3;
/**
 * A kept step stays only while slow windows at its level are, on average (`KEPT_MEMORY`), `MIN_IMPROVEMENT` faster than
 * the one before it. A window this much slower than that one is a new load, judged like any other: undoing the step for
 * it could park its level.
 */
const NEW_LOAD = 1.25;
/**
 * Slow windows a kept step is judged on, as a running mean. Off vsync one window's mean is noisy, so judging each alone
 * undoes a helpful step by chance sooner or later; a longer memory is slower to see a new load.
 */
const KEPT_MEMORY = 8;
/**
 * A load the scale cannot help that replaces a heavier one can stay under a kept step's bar, so it neither loses the
 * step nor leaves room for a probe up. A level that cannot step further is retried from the level above after this much
 * slow time there, doubling each time the retry keeps it.
 */
const RECHECK_MS = MAX_HOLD_MS;
/** Bounds how long such a load keeps a level stepped down; each retry costs about a window at the level above. */
const MAX_RECHECK_MS = 8 * MAX_HOLD_MS;
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
  | 'down'
  | 'down-failed'
  | 'down-lost'
  | 'recheck'
  | 'up'
  | 'probe-failed'
  | 'probe-held'
  | 'warmup'
  | 'discard'
  | 'restart'
  | 'reset';
const KINDS: readonly GovernorEventKind[] = [
  'down',
  'down-failed',
  'down-lost',
  'recheck',
  'up',
  'probe-failed',
  'probe-held',
  'warmup',
  'discard',
  'restart',
  'reset',
];
/** The decisions: kept in a ring of their own, so a burst of causes cannot evict them. */
const DECISIONS: ReadonlySet<GovernorEventKind> = new Set([
  'down',
  'down-failed',
  'down-lost',
  'recheck',
  'up',
  'probe-failed',
  'probe-held',
]);

export type GovernorEvent = {
  kind: GovernorEventKind;
  /** What caused a `warmup`, `discard`, `restart` or `reset`: `init`, `scene`, `quality`, `lighting`, `resize`, `visibility`, `attach:<key>`. */
  tag: string;
  /** Timestamp of the last frame seen, on the `performance.now()` clock. */
  t: number;
  /** Samples the governor had taken when the event happened; indexes `intervals` (offset by `dropped`). */
  sample: number;
  level: number;
  /** The last window's p90 in ms; 0 before the first window. */
  p90: number;
  hold: number;
  /** Failed probes of the level that gates a step up: the sharper level of a transition, else the one above the current. */
  failedProbes: number;
  /** ms of headroom accumulated towards a step up when the event happened. */
  steady: number;
};

export type GovernorTrace = {
  /** Oldest first, decisions and causes interleaved; a `restart` or `reset` carries the state it replaced. */
  events: GovernorEvent[];
  /** The frame intervals the governor was fed, oldest first. */
  intervals: number[];
  /** Intervals fed before the oldest one kept. */
  dropped: number;
};

type EventState = {
  level: number;
  p90: number;
  hold: number;
  failedProbes: number;
  steady: number;
};

/** A bounded ring of events, written without allocating. */
function createEventRing() {
  const order = new Float64Array(EVENT_CAP);
  const kind = new Uint8Array(EVENT_CAP);
  const tag: string[] = new Array<string>(EVENT_CAP).fill('');
  const time = new Float64Array(EVENT_CAP);
  const sampleAt = new Float64Array(EVENT_CAP);
  const level = new Uint8Array(EVENT_CAP);
  const p90 = new Float32Array(EVENT_CAP);
  const hold = new Float32Array(EVENT_CAP);
  const failed = new Uint8Array(EVENT_CAP);
  const steady = new Float32Array(EVENT_CAP);
  let written = 0;
  return {
    push(
      seq: number,
      k: GovernorEventKind,
      label: string,
      t: number,
      sample: number,
      state: EventState,
    ): void {
      const i = written % EVENT_CAP;
      order[i] = seq;
      kind[i] = KINDS.indexOf(k);
      tag[i] = label;
      time[i] = t;
      sampleAt[i] = sample;
      level[i] = state.level;
      p90[i] = state.p90;
      hold[i] = state.hold;
      failed[i] = state.failedProbes;
      steady[i] = state.steady;
      written++;
    },
    read(): { seq: number; event: GovernorEvent }[] {
      const out: { seq: number; event: GovernorEvent }[] = [];
      for (let n = Math.max(0, written - EVENT_CAP); n < written; n++) {
        const i = n % EVENT_CAP;
        out.push({
          seq: order[i] ?? 0,
          event: {
            kind: KINDS[kind[i] ?? 0] ?? 'down',
            tag: tag[i] ?? '',
            t: time[i] ?? 0,
            sample: sampleAt[i] ?? 0,
            level: level[i] ?? 0,
            p90: p90[i] ?? 0,
            hold: hold[i] ?? 0,
            failedProbes: failed[i] ?? 0,
            steady: steady[i] ?? 0,
          },
        });
      }
      return out;
    },
  };
}

/** Bounded rings written without allocating; `read` copies them out. */
function createTrace() {
  const decisions = createEventRing();
  const causes = createEventRing();
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
    event(k: GovernorEventKind, label: string, state: EventState): void {
      (DECISIONS.has(k) ? decisions : causes).push(events++, k, label, now, samples, state);
    },
    read(): GovernorTrace {
      const merged = [...decisions.read(), ...causes.read()].sort((x, y) => x.seq - y.seq);
      const dropped = Math.max(0, samples - INTERVAL_CAP);
      const kept: number[] = [];
      for (let n = dropped; n < samples; n++) kept.push(intervals[n % INTERVAL_CAP] ?? 0);
      return { events: merged.map((m) => m.event), intervals: kept, dropped };
    },
  };
}

type Trace = ReturnType<typeof createTrace>;

export function createResolutionGovernor(trace: Trace = createTrace()): {
  sample(frameMs: number): number;
  /**
   * Drops the samples of the window in progress, keeping the scale. `tag` names the cause in the trace; `liftParks`
   * means the user changed the load (preset, lighting), so parked levels are tried again.
   */
  discardWindow: (tag?: string, options?: { liftParks?: boolean }) => void;
  /** Back to full resolution, remembering the hold and the failed probes. */
  restart: (tag?: string) => void;
  /** Back to full resolution and forgets everything learnt about the device. */
  reset: (tag?: string) => void;
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
  /** Mean interval of the window that caused the last step down; 0 when no step awaits its verdict. */
  let beforeStep = 0;
  /** Whether that window was slowed by a shift (`SHIFT_SLACK`). */
  let beforeShift = false;
  const failedProbes = new Uint8Array(MAX_LEVEL + 1);
  /** Reverted steps down from each level (`MAX_FAILED_DOWNS`). */
  const failedDowns = new Uint8Array(MAX_LEVEL + 1);
  /** Per level, `beforeStep` of the kept step down into it; 0 when it was entered otherwise. */
  const keptFrom = new Float64Array(MAX_LEVEL + 1);
  /** Per level, the running mean of slow windows since the step into it was kept, and how many it holds. */
  const keptMean = new Float64Array(MAX_LEVEL + 1);
  const keptWindows = new Uint8Array(MAX_LEVEL + 1);
  /**
   * The level left by a kept step that lost its gain over a full memory, or lost it again after that, whose own kept step
   * may stem from an older load; 0 for none. If the step from it fails, the scale stopped helping there: its kept step is
   * dropped and the level above is doubted, so a steady load stops at the first step that still helps and a new load the
   * scale cannot help climbs back to full resolution.
   */
  let doubted = 0;
  /** Slow time at a level that cannot step further (`RECHECK_MS`), and the wait for the next retry. */
  let quiet = 0;
  let recheckAfter = RECHECK_MS;
  /** Whether the step awaiting its verdict is such a retry. */
  let rechecking = false;
  const ring = new Float64Array(WINDOW);
  const scratch = new Float64Array(WINDOW);
  const scale = (): number => Math.max(FLOOR, 1 - level * STEP);
  const toFull = (): void => {
    level = 0;
    count = 0;
    steady = 0;
    sinceUp = Infinity;
    probing = false;
    settle = 0;
    beforeStep = 0;
    doubted = 0;
    quiet = 0;
    rechecking = false;
  };
  const note = (
    k: GovernorEventKind,
    tag: string,
    failedLevel = Math.max(level - 1, 0),
    held = steady,
  ): void => {
    trace.event(k, tag, {
      level,
      p90: lastP90,
      hold,
      failedProbes: failedProbes[failedLevel] ?? 0,
      steady: held,
    });
  };
  const revert = (k: GovernorEventKind, to = level - 1): number => {
    level = to;
    steady = 0;
    quiet = 0;
    count = 0;
    settle = SETTLE_FRAMES;
    note(k, '', level);
    return scale();
  };
  return {
    sample(frameMs) {
      trace.interval(frameMs);
      sinceUp += frameMs;
      if (probing && sinceUp >= hold) {
        probing = false;
        failedProbes[level] = 0;
        hold = HOLD_MS;
        note('probe-held', '', level);
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
      let sum = 0;
      for (const ms of scratch) sum += ms;
      const mean = sum / WINDOW;
      const median = ((scratch[WINDOW / 2 - 1] ?? 0) + (scratch[WINDOW / 2] ?? 0)) / 2;
      const shift = mean <= median * (1 + SHIFT_SLACK);
      if (beforeStep > 0 && level > 0) {
        const helped =
          mean <= beforeStep * (1 - MIN_IMPROVEMENT) ||
          (beforeShift &&
            shift &&
            p90 <= P90_LIMIT_MS &&
            mean <= beforeStep * (1 - SHIFT_IMPROVEMENT));
        const from = beforeStep;
        beforeStep = 0;
        const retried = rechecking;
        rechecking = false;
        if (!helped) {
          // A mean, not the p90: vsync quantises the p90 to whole frames.
          const left = level - 1;
          // A retry is judged on one window, so a chance failure must not park a level that still helps.
          if (retried) keptFrom[level] = 0;
          else failedDowns[left] = (failedDowns[left] ?? 0) + 1;
          if (left > 0 && left === doubted) {
            keptFrom[left] = 0;
            doubted = left - 1;
            return revert('down-failed', left - 1);
          }
          doubted = 0;
          return revert('down-failed');
        }
        if (retried) {
          // The step still helps; a new bar from one window would put it at risk of a chance loss on every retry.
          keptFrom[level] = Math.max(keptFrom[level] ?? 0, from);
          recheckAfter = Math.min(recheckAfter * 2, MAX_RECHECK_MS);
        } else {
          keptFrom[level] = from;
          keptWindows[level] = 0;
        }
        // The next decision takes a fresh window: one that passed by luck would step on at once.
        count = 0;
        return scale();
      }
      const kept = keptFrom[level] ?? 0;
      if (p90 > P90_LIMIT_MS && kept > 0 && mean <= kept * NEW_LOAD) {
        const n = Math.min((keptWindows[level] ?? 0) + 1, KEPT_MEMORY);
        const running = (keptMean[level] ?? 0) + (mean - (keptMean[level] ?? 0)) / n;
        keptWindows[level] = n;
        keptMean[level] = running;
        if (n === KEPT_MEMORY && doubted === level - 1) doubted = 0;
        if (running > kept * (1 - MIN_IMPROVEMENT)) {
          // The kept step lost its gain, most likely a lucky window kept it; it did help once, so this is not counted.
          keptFrom[level] = 0;
          doubted = n === KEPT_MEMORY || doubted === level || doubted === level - 1 ? level - 1 : 0;
          return revert('down-lost');
        }
      }
      if (p90 > P90_LIMIT_MS) {
        if (level < MAX_LEVEL && (failedDowns[level] ?? 0) < MAX_FAILED_DOWNS) {
          const failedProbe = probing;
          const left = level;
          if (failedProbe) {
            // The step up did not hold: the headroom was borrowed, so wait longer and count the failure.
            failedProbes[level] = (failedProbes[level] ?? 0) + 1;
            hold = Math.min(hold * 2, MAX_HOLD_MS);
          }
          level++;
          quiet = 0;
          beforeStep = mean;
          beforeShift = shift;
          settle = SETTLE_FRAMES;
          note(failedProbe ? 'probe-failed' : 'down', '', left);
        } else {
          rechecking = false;
          if (level > 0) {
            quiet += sum;
            if (quiet >= recheckAfter) {
              // Judged again on the load of now; if it fails, the levels above follow as after a lost step.
              doubted = level - 1;
              rechecking = true;
              probing = false;
              return revert('recheck');
            }
          }
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
          keptFrom[level] = 0;
          steady = 0;
          quiet = 0;
          rechecking = false;
          sinceUp = 0;
          count = 0;
          probing = true;
          beforeStep = 0;
          settle = SETTLE_FRAMES;
          note('up', '', level, held);
        }
      } else {
        steady = 0;
      }
      return scale();
    },
    discardWindow(tag = '', { liftParks = false } = {}) {
      // The load changed: a step awaiting its verdict is undone, so the new load is judged from where it was.
      const pending = beforeStep > 0;
      if (pending) {
        level--;
        quiet = 0;
      }
      beforeStep = 0;
      doubted = 0;
      rechecking = false;
      if (liftParks) {
        failedDowns.fill(0);
        recheckAfter = RECHECK_MS;
      }
      note('warmup', tag);
      if (count > 0 || steady > 0 || pending) note('discard', tag);
      count = 0;
      steady = 0;
    },
    restart(tag = '') {
      note('restart', tag);
      toFull();
    },
    reset(tag = '') {
      note('reset', tag);
      toFull();
      hold = HOLD_MS;
      failedProbes.fill(0);
      failedDowns.fill(0);
      keptFrom.fill(0);
      recheckAfter = RECHECK_MS;
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
  warmUp(tag?: string, options?: { liftParks?: boolean }): void;
  resetScale(tag?: string): void;
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
  const warmUp = (tag?: string, options?: { liftParks?: boolean }): void => {
    governor.discardWindow(tag, options);
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
      governor.restart(tag);
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
