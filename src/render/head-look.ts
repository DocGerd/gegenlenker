import { HEAD_REST, type HeadPose } from '../contracts/render';
import { COCKPIT_FOV } from './cockpit-band';

// No `three` import: the input layer shares this math.

const rad = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * How far the head turns from straight ahead. Looking up sinks the dash, so it stops short of
 * letting the opaque HUD band meet open cab (`cockpit-interior.test.ts` pins it); down has no such limit.
 */
export const HEAD_LIMITS = { yaw: rad(100), pitchUp: rad(3), pitchDown: rad(10) } as const;
/** Where a held glance key turns the head to. */
export const GLANCE_YAW = rad(80);
/** CSS px a pointer travels before it starts a look-around. */
export const DRAG_SLOP_PX = 8;
/** The head covers this many times the pane's field of view per pane height dragged. */
const DRAG_GAIN = 2;
/** About how long the head takes to ease back to forward. */
export const HEAD_RETURN_S = 0.25;
const EASE_TAU = HEAD_RETURN_S / 6;
const SETTLED = rad(0.05);

export function clampHead({ yaw, pitch }: HeadPose): HeadPose {
  return {
    yaw: Math.min(HEAD_LIMITS.yaw, Math.max(-HEAD_LIMITS.yaw, yaw)),
    pitch: Math.min(HEAD_LIMITS.pitchUp, Math.max(-HEAD_LIMITS.pitchDown, pitch)),
  };
}

export const sameHead = (a: HeadPose, b: HeadPose): boolean =>
  a.yaw === b.yaw && a.pitch === b.pitch;

/** Turns the head as if dragging the scene: right turns it left, down turns it up. */
export function dragHead(head: HeadPose, dx: number, dy: number, paneHeight: number): HeadPose {
  const perPx = (DRAG_GAIN * rad(COCKPIT_FOV)) / paneHeight;
  return clampHead({ yaw: head.yaw + dx * perPx, pitch: head.pitch + dy * perPx });
}

/** Where the held glance keys turn the head to; both held cancel out. */
export function glanceTarget(left: boolean, right: boolean): HeadPose {
  if (left === right) return HEAD_REST;
  return { yaw: left ? GLANCE_YAW : -GLANCE_YAW, pitch: 0 };
}

/** One frame of `seconds` of easing towards `target`; lands on it once close. */
export function easeHead(head: HeadPose, target: HeadPose, seconds: number): HeadPose {
  const k = 1 - Math.exp(-Math.max(0, seconds) / EASE_TAU);
  const yaw = head.yaw + (target.yaw - head.yaw) * k;
  const pitch = head.pitch + (target.pitch - head.pitch) * k;
  if (Math.abs(target.yaw - yaw) < SETTLED && Math.abs(target.pitch - pitch) < SETTLED) {
    return target;
  }
  return { yaw, pitch };
}
