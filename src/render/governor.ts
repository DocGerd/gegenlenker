const WINDOW = 60;
const P90_LIMIT_MS = 18.5;
const STEP = 0.15;
const FLOOR = 0.5;

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
