import { describe, expect, it } from 'vitest';
import { HEAD_REST, type FreePose } from '../contracts/render';
import {
  FREE_MAX_HEIGHT,
  FREE_MIN_HEIGHT,
  FREE_PITCH,
  clampFreePose,
  flyBy,
  flyStep,
  lookBy,
  panBy,
  pinchFly,
  poseFromGaze,
  wheelFly,
} from './free-look';
import { dragHead } from './head-look';

const BOUNDS = { minX: -50, minY: -30, maxX: 50, maxY: 30 };
const START: FreePose = { x: 0, y: 0, z: 10, yaw: 0, pitch: 0 };
const NONE = { turn: 0, pitch: 0, fly: 0 };

const forward = (p: FreePose): [number, number, number] => [
  Math.cos(p.pitch) * Math.cos(p.yaw),
  Math.cos(p.pitch) * Math.sin(p.yaw),
  Math.sin(p.pitch),
];
const travelled = (a: FreePose, b: FreePose): number[] => [b.x - a.x, b.y - a.y, b.z - a.z];
const unit = (v: readonly number[]): number[] => {
  const n = Math.hypot(...v);
  return v.map((c) => c / n);
};

describe('clampFreePose', () => {
  it('holds the eye inside the bounds, the height range and the pitch range', () => {
    const wild = { x: 1e6, y: -1e6, z: 1e6, yaw: 0, pitch: 3 };
    expect(clampFreePose(wild, BOUNDS)).toEqual({
      x: BOUNDS.maxX,
      y: BOUNDS.minY,
      z: FREE_MAX_HEIGHT,
      yaw: 0,
      pitch: FREE_PITCH.max,
    });
    const low = clampFreePose({ ...START, z: -5, pitch: -3 }, BOUNDS);
    expect(low.z).toBe(FREE_MIN_HEIGHT);
    expect(low.pitch).toBe(FREE_PITCH.min);
  });

  it('leaves a pose inside the limits alone and wraps the yaw', () => {
    expect(clampFreePose(START, BOUNDS)).toEqual(START);
    const wrapped = clampFreePose({ ...START, yaw: 3 * Math.PI }, BOUNDS);
    expect(Math.abs(wrapped.yaw)).toBeCloseTo(Math.PI, 9);
  });
});

describe('lookBy', () => {
  it('turns the way dragHead does: right turns left, down looks up', () => {
    const head = dragHead(HEAD_REST, 30, 20, 600);
    const pose = lookBy(START, 30, 20, 600, BOUNDS);
    expect(Math.sign(pose.yaw)).toBe(Math.sign(head.yaw));
    expect(Math.sign(pose.pitch)).toBe(Math.sign(head.pitch));
    expect(pose.yaw).toBeGreaterThan(0);
    expect(pose.pitch).toBeGreaterThan(0);
  });

  it('stops at the pitch limits and never moves the eye', () => {
    const up = lookBy(START, 0, 1e6, 600, BOUNDS);
    expect(up.pitch).toBe(FREE_PITCH.max);
    const down = lookBy(START, 0, -1e6, 600, BOUNDS);
    expect(down.pitch).toBe(FREE_PITCH.min);
    expect([up.x, up.y, up.z]).toEqual([START.x, START.y, START.z]);
  });
});

describe('panBy', () => {
  it('slides the eye with the scene under the finger: right moves it left, down moves it up', () => {
    const facing = { ...START, yaw: Math.PI / 2 };
    const right = panBy(facing, 100, 0, 600, BOUNDS);
    // facing +y, the camera's left is -x
    expect(right.x).toBeLessThan(facing.x);
    expect(right.y).toBeCloseTo(facing.y, 9);
    const down = panBy(START, 0, 100, 600, BOUNDS);
    expect(down.z).toBeGreaterThan(START.z);
    expect(down.x).toBeCloseTo(START.x, 9);
  });

  it('keeps the look direction', () => {
    const pose = { ...START, yaw: 1, pitch: -0.3 };
    const moved = panBy(pose, 40, -25, 600, BOUNDS);
    expect([moved.yaw, moved.pitch]).toEqual([pose.yaw, pose.pitch]);
  });
});

describe('flying along the gaze', () => {
  const gazing: FreePose = { ...START, yaw: 0.7, pitch: -0.4 };

  it('flyBy, wheelFly and pinchFly move the eye along its look direction', () => {
    for (const moved of [
      flyBy(gazing, 5, BOUNDS),
      wheelFly(gazing, Math.exp(0.1), BOUNDS),
      pinchFly(gazing, 1.3, BOUNDS),
    ]) {
      const step = unit(travelled(gazing, moved));
      const look = forward(gazing);
      for (let i = 0; i < 3; i++) expect(step[i]).toBeCloseTo(look[i] as number, 9);
    }
  });

  it('wheelFly and pinchFly go back for the opposite gesture', () => {
    const ahead = wheelFly(gazing, Math.exp(0.1), BOUNDS);
    const behind = wheelFly(gazing, Math.exp(-0.1), BOUNDS);
    expect(ahead.x - gazing.x).toBeGreaterThan(0);
    expect(behind.x - gazing.x).toBeLessThan(0);
    expect(pinchFly(gazing, 0.7, BOUNDS).x).toBeLessThan(gazing.x);
  });

  it('steps further per gesture from a greater height', () => {
    const level = { ...START, pitch: 0 };
    const low = wheelFly({ ...level, z: 3 }, Math.exp(0.1), BOUNDS);
    const high = wheelFly({ ...level, z: 40 }, Math.exp(0.1), BOUNDS);
    expect(high.x).toBeGreaterThan(low.x);
  });

  it('cannot leave the bounds or the height range', () => {
    const out = flyBy({ ...START, pitch: FREE_PITCH.max }, 1e6, BOUNDS);
    expect(out.z).toBe(FREE_MAX_HEIGHT);
    expect(flyBy(START, 1e6, BOUNDS).x).toBe(BOUNDS.maxX);
    expect(flyBy({ ...START, pitch: FREE_PITCH.min }, 1e6, BOUNDS).z).toBe(FREE_MIN_HEIGHT);
  });

  it('starts outside the limits where the orbit was, goes no further out and back in', () => {
    const outside = { ...START, x: BOUNDS.maxX + 20, z: FREE_MAX_HEIGHT + 10 };
    expect(clampFreePose(outside, BOUNDS, outside)).toEqual(outside);
    const away = flyBy({ ...outside, pitch: FREE_PITCH.max }, 100, BOUNDS);
    expect(away.x).toBe(outside.x);
    expect(away.z).toBe(outside.z);
    const back = flyBy({ ...outside, yaw: Math.PI, pitch: FREE_PITCH.min }, 5, BOUNDS);
    expect(back.x).toBeLessThan(outside.x);
    expect(back.z).toBeLessThan(outside.z);
  });
});

describe('flyStep', () => {
  it('does nothing without a held key or time', () => {
    const held = { turn: 1, pitch: 1, fly: 1 };
    expect(flyStep(START, NONE, 1, BOUNDS)).toEqual(START);
    expect(flyStep(START, held, 0, BOUNDS)).toEqual(START);
    expect(flyStep(START, held, -1, BOUNDS)).toEqual(START);
  });

  it('turns, pitches and flies in the direction of the held keys', () => {
    expect(flyStep(START, { ...NONE, turn: 1 }, 0.5, BOUNDS).yaw).toBeGreaterThan(0);
    expect(flyStep(START, { ...NONE, turn: -1 }, 0.5, BOUNDS).yaw).toBeLessThan(0);
    expect(flyStep(START, { ...NONE, pitch: 1 }, 0.5, BOUNDS).pitch).toBeGreaterThan(0);
    expect(flyStep(START, { ...NONE, fly: 1 }, 0.5, BOUNDS).x).toBeGreaterThan(0);
    expect(flyStep(START, { ...NONE, fly: -1 }, 0.5, BOUNDS).x).toBeLessThan(0);
  });

  it('covers the same turn and distance whatever the frame rate', () => {
    const turning = { ...NONE, turn: 1 };
    let turned = START;
    for (let i = 0; i < 60; i++) turned = flyStep(turned, turning, 1 / 60, BOUNDS);
    expect(turned.yaw).toBeCloseTo(flyStep(START, turning, 1, BOUNDS).yaw, 9);
    const straight = { ...NONE, fly: 1 };
    let many = START;
    for (let i = 0; i < 60; i++) many = flyStep(many, straight, 1 / 60, BOUNDS);
    expect(many.x).toBeCloseTo(flyStep(START, straight, 1, BOUNDS).x, 6);
  });
});

describe('poseFromGaze', () => {
  it('reads the yaw and pitch of a direction, normalising it', () => {
    const pose = poseFromGaze({ x: 3, y: 4, z: 5 }, { x: 0, y: 2, z: 0 });
    expect(pose).toEqual({ x: 3, y: 4, z: 5, yaw: Math.PI / 2, pitch: 0 });
    const up = poseFromGaze({ x: 0, y: 0, z: 5 }, { x: 1, y: 0, z: 1 });
    expect(up.yaw).toBeCloseTo(0, 9);
    expect(up.pitch).toBeCloseTo(Math.PI / 4, 9);
  });

  it('round-trips with the look direction', () => {
    const pose: FreePose = { x: 1, y: 2, z: 7, yaw: -2.1, pitch: -0.5 };
    const [x, y, z] = forward(pose);
    const back = poseFromGaze(pose, { x, y, z });
    expect(back.yaw).toBeCloseTo(pose.yaw, 9);
    expect(back.pitch).toBeCloseTo(pose.pitch, 9);
  });
});
