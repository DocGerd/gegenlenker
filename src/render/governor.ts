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

export function createResolutionGovernor(): {
  sample(frameMs: number): number;
  /** Drops the samples of the window in progress, keeping the scale. */
  discardWindow: () => void;
  /** Back to full resolution, remembering the hold and the failed probes. */
  restart: () => void;
  /** Back to full resolution and forgets everything learnt about the device. */
  reset: () => void;
  scale: () => number;
} {
  let level = 0;
  let count = 0;
  let next = 0;
  let steady = 0;
  let sinceUp = Infinity;
  let hold = HOLD_MS;
  let probing = false;
  let settle = 0;
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
  return {
    sample(frameMs) {
      sinceUp += frameMs;
      if (probing && sinceUp >= hold) {
        probing = false;
        failedProbes[level] = 0;
        hold = HOLD_MS;
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
      if (p90 > P90_LIMIT_MS) {
        if (level < MAX_LEVEL) {
          if (probing) {
            // The step up did not hold: the headroom was borrowed, so wait longer and count the failure.
            failedProbes[level] = (failedProbes[level] ?? 0) + 1;
            hold = Math.min(hold * 2, MAX_HOLD_MS);
          }
          level++;
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
          level--;
          steady = 0;
          sinceUp = 0;
          count = 0;
          probing = true;
          settle = SETTLE_FRAMES;
        }
      } else {
        steady = 0;
      }
      return scale();
    },
    discardWindow() {
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
    // Armed from the next frame: an attach can block the thread past any fixed grace.
    graceFromNextFrame = true;
    graceEnd = Infinity;
  };
  return {
    frame(now) {
      if (!Number.isFinite(now)) return;
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
    resetTiming() {
      last = -1;
      longBefore = false;
      ema = 0;
      count = 0;
      next = 0;
      governor.restart();
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
