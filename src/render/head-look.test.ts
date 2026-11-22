import { describe, expect, it } from 'vitest';
import { HEAD_REST, type HeadPose } from '../contracts/render';
import {
  clampHead,
  dragHead,
  easeHead,
  GLANCE_YAW,
  glanceTarget,
  HEAD_LIMITS,
  HEAD_RETURN_S,
} from './head-look';

describe('dragging the head', () => {
  it('turns it as if dragging the scene: right looks left, down looks up', () => {
    const next = dragHead(HEAD_REST, 10, 10, 600);
    expect(next.yaw).toBeGreaterThan(0);
    expect(next.pitch).toBeGreaterThan(0);
    expect(dragHead(HEAD_REST, -10, -10, 600)).toEqual({ yaw: -next.yaw, pitch: -next.pitch });
  });

  it('turns by the same angle per px in both axes, more in a smaller pane', () => {
    const tall = dragHead(HEAD_REST, 10, 10, 800);
    const short = dragHead(HEAD_REST, 10, 10, 400);
    expect(tall.yaw).toBeCloseTo(tall.pitch, 12);
    expect(short.yaw).toBeCloseTo(2 * tall.yaw, 12);
  });

  it('accumulates from the current pose and stops at the limits', () => {
    const once = dragHead(HEAD_REST, 20, 0, 600);
    expect(dragHead(once, 20, 0, 600).yaw).toBeCloseTo(2 * once.yaw, 12);
    expect(dragHead(HEAD_REST, 1e6, 1e6, 600)).toEqual({
      yaw: HEAD_LIMITS.yaw,
      pitch: HEAD_LIMITS.pitchUp,
    });
    expect(dragHead(HEAD_REST, -1e6, -1e6, 600)).toEqual({
      yaw: -HEAD_LIMITS.yaw,
      pitch: -HEAD_LIMITS.pitchDown,
    });
  });
});

describe('head limits', () => {
  it('are 100 degrees of yaw either way, 10 of pitch down and 3 up', () => {
    const rad = (degrees: number): number => (degrees * Math.PI) / 180;
    expect(clampHead({ yaw: 9, pitch: -9 })).toEqual({ yaw: rad(100), pitch: -rad(10) });
    expect(clampHead({ yaw: -9, pitch: 9 })).toEqual({ yaw: -rad(100), pitch: rad(3) });
    expect(clampHead({ yaw: 0.2, pitch: 0.04 })).toEqual({ yaw: 0.2, pitch: 0.04 });
  });

  it('hold the glance inside them', () => {
    expect(GLANCE_YAW).toBeLessThanOrEqual(HEAD_LIMITS.yaw);
  });
});

describe('glance keys', () => {
  it('look left or right while held, and straight ahead when neither or both are', () => {
    expect(glanceTarget(true, false)).toEqual({ yaw: GLANCE_YAW, pitch: 0 });
    expect(glanceTarget(false, true)).toEqual({ yaw: -GLANCE_YAW, pitch: 0 });
    expect(glanceTarget(false, false)).toEqual(HEAD_REST);
    expect(glanceTarget(true, true)).toEqual(HEAD_REST);
  });
});

describe('easing the head', () => {
  const run = (from: HeadPose, target: HeadPose, seconds: number, fps = 60): HeadPose => {
    let head = from;
    for (let t = 0; t < seconds - 1e-9; t += 1 / fps) head = easeHead(head, target, 1 / fps);
    return head;
  };
  const far: HeadPose = { yaw: HEAD_LIMITS.yaw, pitch: -HEAD_LIMITS.pitchDown };

  it('returns from the furthest look to forward, landing on it', () => {
    expect(run(far, HEAD_REST, HEAD_RETURN_S * 2)).toBe(HEAD_REST);
  });

  it('is mostly back by the return time', () => {
    expect(run(far, HEAD_REST, HEAD_RETURN_S).yaw).toBeLessThan(HEAD_LIMITS.yaw * 0.02);
  });

  it('moves monotonically and never overshoots', () => {
    let head = far;
    for (let i = 0; i < 60; i++) {
      const next = easeHead(head, HEAD_REST, 1 / 60);
      expect(next.yaw).toBeLessThanOrEqual(head.yaw);
      expect(next.yaw).toBeGreaterThanOrEqual(0);
      expect(next.pitch).toBeGreaterThanOrEqual(head.pitch);
      expect(next.pitch).toBeLessThanOrEqual(0);
      head = next;
    }
  });

  it('takes the same path at any frame rate', () => {
    const a = run(far, HEAD_REST, 0.1, 30);
    const b = run(far, HEAD_REST, 0.1, 240);
    expect(a.yaw).toBeCloseTo(b.yaw, 6);
  });

  it('stays on a target it has reached, and a frame of no time moves nothing', () => {
    expect(easeHead(HEAD_REST, HEAD_REST, 1)).toBe(HEAD_REST);
    expect(easeHead(far, HEAD_REST, 0)).toEqual(far);
  });

  it('glances to the held side and settles there', () => {
    const target = glanceTarget(false, true);
    expect(run(HEAD_REST, target, 2)).toBe(target);
  });
});
