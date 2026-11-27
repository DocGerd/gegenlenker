/** A mouse move above this many px in one event is a glitch, not a turn (estimate). */
export const MAX_LOOK_DELTA_PX = 300;
/** He looks up and down this far from level. */
export const PITCH_LIMIT = (85 * Math.PI) / 180;

export type LookSettings = {
  /** Degrees per mouse count. */
  readonly degPerCount: number;
  /** Mouse up looks down. */
  readonly invert: boolean;
};

/** His facing under mouse look: heading in the sim plane (radians, counter-clockwise), pitch up positive. */
export type Look = {
  heading(): number;
  pitch(): number;
  /** Mouse look follows the pointer from the next move after the lock; moves while unlocked are ignored. */
  lock(): void;
  unlock(): void;
  /** One `mousemove`'s `movementX`/`movementY` while locked. */
  move(dx: number, dy: number): void;
};

const clampDelta = (d: number): number =>
  Math.max(-MAX_LOOK_DELTA_PX, Math.min(MAX_LOOK_DELTA_PX, d));

/** Wraps to (-π, π]. */
const wrap = (a: number): number => {
  const turn = 2 * Math.PI;
  const r = a - turn * Math.round(a / turn);
  return r <= -Math.PI ? r + turn : r;
};

/** `settings` is read per move, so a changed setting applies at once. */
export function createLook(
  start: { readonly heading: number; readonly pitch: number },
  settings: () => LookSettings,
): Look {
  let { heading, pitch } = start;
  let locked = false;
  // The first move after a lock can carry a jump from the cursor's last position.
  let fresh = false;
  return {
    heading: () => heading,
    pitch: () => pitch,
    lock() {
      locked = true;
      fresh = true;
    },
    unlock() {
      locked = false;
    },
    move(dx, dy) {
      if (!locked) return;
      if (fresh) {
        fresh = false;
        return;
      }
      const { degPerCount, invert } = settings();
      const rad = (degPerCount * Math.PI) / 180;
      // Right is clockwise, which lowers the counter-clockwise heading; down looks down.
      heading = wrap(heading - clampDelta(dx) * rad);
      pitch = Math.max(
        -PITCH_LIMIT,
        Math.min(PITCH_LIMIT, pitch + (invert ? 1 : -1) * clampDelta(dy) * rad),
      );
    },
  };
}
