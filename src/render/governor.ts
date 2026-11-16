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
  let frames: number[] = [];
  return {
    sample(frameMs) {
      frames.push(frameMs);
      if (frames.length > WINDOW) frames.shift();
      if (frames.length === WINDOW) {
        const sorted = [...frames].sort((a, b) => a - b);
        const p90 = sorted[Math.ceil(0.9 * WINDOW) - 1] ?? 0;
        if (p90 > P90_LIMIT_MS) {
          scale = Math.max(FLOOR, scale - STEP);
          frames = [];
        }
      }
      return scale;
    },
    reset() {
      scale = 1;
      frames = [];
    },
    scale: () => scale,
  };
}
