const WINDOW = 60;
const P90_LIMIT_MS = 18.5;
/** A window this fast counts towards stepping the scale back up; the gap to the limit is the hysteresis. */
const P90_HEADROOM_MS = 18;
const HOLD_MS = 4000;
const MAX_HOLD_MS = 32000;
/** Startup hitches (shader links, texture uploads) follow a scene or an attach; they say nothing about steady load. */
const WARM_UP_MS = 2000;
const STEP = 0.15;
const FLOOR = 0.5;
const MAX_LEVEL = Math.ceil((1 - FLOOR) / STEP);
const EMA_SMOOTHING = 0.1;
const P95_WINDOW = 120;
// An isolated interval this long is a pause or hidden tab; a run of them is real load.
const MAX_GAP_MS = 500;

export function createResolutionGovernor(): {
  sample(frameMs: number): number;
  /** Drops the samples of the window in progress, keeping the scale. */
  discardWindow: () => void;
  reset: () => void;
  scale: () => number;
} {
  let level = 0;
  let count = 0;
  let next = 0;
  let steady = 0;
  let sinceUp = Infinity;
  let hold = HOLD_MS;
  const ring = new Float64Array(WINDOW);
  const scratch = new Float64Array(WINDOW);
  const scale = (): number => Math.max(FLOOR, 1 - level * STEP);
  return {
    sample(frameMs) {
      ring[next] = frameMs;
      next = (next + 1) % WINDOW;
      if (count < WINDOW) count++;
      sinceUp += frameMs;
      if (count < WINDOW) return scale();
      scratch.set(ring);
      scratch.sort();
      const p90 = scratch[Math.ceil(0.9 * WINDOW) - 1] ?? 0;
      if (p90 > P90_LIMIT_MS) {
        level = Math.min(MAX_LEVEL, level + 1);
        // Stepping down soon after a step up means the headroom was borrowed: wait longer next time.
        hold = sinceUp < hold ? Math.min(hold * 2, MAX_HOLD_MS) : HOLD_MS;
        steady = 0;
        count = 0;
      } else if (level > 0 && p90 <= P90_HEADROOM_MS) {
        steady += frameMs;
        if (steady >= hold) {
          level--;
          steady = 0;
          sinceUp = 0;
          count = 0;
        }
      } else {
        steady = 0;
      }
      return scale();
    },
    discardWindow() {
      count = 0;
    },
    reset() {
      level = 0;
      count = 0;
      steady = 0;
      sinceUp = Infinity;
      hold = HOLD_MS;
    },
    scale,
  };
}

/**
 * Times animation-frame callbacks, drawn or not: the app skips redundant draws, so only the callback
 * cadence says whether the browser keeps up.
 */
export function createFrameTimer(): {
  frame(now: number): void;
  resetTiming(): void;
  /** Ignores the governor for a while: the next frames carry startup hitches, not steady load. */
  warmUp(): void;
  resetScale(): void;
  scale: () => number;
  fps(): number;
  p95Ms(): number;
} {
  const governor = createResolutionGovernor();
  const ring = new Float64Array(P95_WINDOW);
  const scratch = new Float64Array(P95_WINDOW);
  let last = -1;
  let longBefore = false;
  let graceEnd = 0;
  let graceFromNextFrame = false;
  let ema = 0;
  let count = 0;
  let next = 0;
  const warmUp = (): void => {
    governor.discardWindow();
    if (last < 0) graceFromNextFrame = true;
    else graceEnd = Math.max(graceEnd, last + WARM_UP_MS);
  };
  return {
    frame(now) {
      const dt = now - last;
      const long = dt > MAX_GAP_MS;
      if (last >= 0 && (!long || longBefore)) {
        ema = ema === 0 ? dt : ema + EMA_SMOOTHING * (dt - ema);
        ring[next] = dt;
        next = (next + 1) % P95_WINDOW;
        if (count < P95_WINDOW) count++;
        if (now >= graceEnd) governor.sample(dt);
      }
      if (graceFromNextFrame) {
        graceEnd = now + WARM_UP_MS;
        graceFromNextFrame = false;
      }
      longBefore = last >= 0 && long;
      last = now;
    },
    /** Drops the previous timestamp too, so a gap (pause, hidden tab, new scene) is never sampled. */
    resetTiming() {
      last = -1;
      longBefore = false;
      ema = 0;
      count = 0;
      next = 0;
      governor.reset();
      graceEnd = 0;
      warmUp();
    },
    warmUp,
    resetScale: governor.reset,
    scale: governor.scale,
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
