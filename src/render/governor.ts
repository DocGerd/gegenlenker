const WINDOW = 60;
const P90_LIMIT_MS = 18.5;
const STEP = 0.15;
const FLOOR = 0.5;
const EMA_SMOOTHING = 0.1;
const P95_WINDOW = 120;
// An isolated interval this long is a pause or hidden tab; a run of them is real load.
const MAX_GAP_MS = 500;

export function createResolutionGovernor(): {
  sample(frameMs: number): number;
  reset(): void;
  scale(): number;
} {
  let scale = 1;
  let count = 0;
  let next = 0;
  const ring = new Float64Array(WINDOW);
  const scratch = new Float64Array(WINDOW);
  return {
    sample(frameMs) {
      ring[next] = frameMs;
      next = (next + 1) % WINDOW;
      if (count < WINDOW) count++;
      if (count === WINDOW) {
        scratch.set(ring);
        scratch.sort();
        if ((scratch[Math.ceil(0.9 * WINDOW) - 1] ?? 0) > P90_LIMIT_MS) {
          scale = Math.max(FLOOR, scale - STEP);
          count = 0;
        }
      }
      return scale;
    },
    reset() {
      scale = 1;
      count = 0;
    },
    scale: () => scale,
  };
}

/**
 * Times animation-frame callbacks, drawn or not: the app skips redundant draws, so only the callback
 * cadence says whether the browser keeps up.
 */
export function createFrameTimer(): {
  frame(now: number): void;
  resetTiming(): void;
  resetScale(): void;
  scale(): number;
  fps(): number;
  p95Ms(): number;
} {
  const governor = createResolutionGovernor();
  const ring = new Float64Array(P95_WINDOW);
  const scratch = new Float64Array(P95_WINDOW);
  let last = -1;
  let longBefore = false;
  let ema = 0;
  let count = 0;
  let next = 0;
  return {
    frame(now) {
      const dt = now - last;
      const long = dt > MAX_GAP_MS;
      if (last >= 0 && (!long || longBefore)) {
        ema = ema === 0 ? dt : ema + EMA_SMOOTHING * (dt - ema);
        ring[next] = dt;
        next = (next + 1) % P95_WINDOW;
        if (count < P95_WINDOW) count++;
        governor.sample(dt);
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
    },
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
