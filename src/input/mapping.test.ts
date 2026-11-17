import { describe, expect, it } from 'vitest';
import {
  POINTER_SWEEP_DEG,
  createInputState,
  pointerAngleDeg,
  rimRotationDeg,
  steerDisplay,
  stepReset,
  turnTicks,
} from './mapping';

const TURNS = 5;
/** Steer value whose wheel rotation is `deg`. */
const steerAt = (deg: number): number => deg / (TURNS * 180);
const centred = (target: number, actual: number, prev: boolean): boolean =>
  steerDisplay(target, actual, TURNS, prev).centred;
const centredAt = (deg: number, prev: boolean): boolean =>
  centred(steerAt(deg), steerAt(deg), prev);

describe('steerDisplay', () => {
  it.each([-2, -1, 1, 2])('does not read %i whole turns from straight as centred', (turns) => {
    const steer = (turns * 2) / TURNS;
    expect(centred(steer, steer, false)).toBe(false);
    expect(centred(steer, steer, true)).toBe(false);
  });

  it('enters inside 6 degrees and leaves beyond 8', () => {
    expect(centredAt(5.9, false)).toBe(true);
    expect(centredAt(6.1, false)).toBe(false);
    expect(centredAt(7.9, true)).toBe(true);
    expect(centredAt(8.1, true)).toBe(false);
    expect(centredAt(-5.9, false)).toBe(true);
    expect(centredAt(-6.1, false)).toBe(false);
  });

  it('needs both target and actual steer inside the window', () => {
    expect(centred(0, steerAt(7), false)).toBe(false);
    expect(centred(0, steerAt(7), true)).toBe(true);
    expect(centred(steerAt(7), 0, false)).toBe(false);
    expect(centred(steerAt(7), 0, true)).toBe(true);
    expect(centred(0, steerAt(-5.9), false)).toBe(true);
    expect(centred(0, steerAt(-8.1), true)).toBe(false);
  });
});

describe('direction convention', () => {
  it('turns the wheel counter-clockwise for a left steer', () => {
    expect(rimRotationDeg(0.2, 5)).toBeCloseTo(-180);
    expect(rimRotationDeg(-0.2, 5)).toBeCloseTo(180);
  });

  it('swings the pointer opposite to the steer sign, to the end stops at full lock', () => {
    expect(pointerAngleDeg(1)).toBeCloseTo(-POINTER_SWEEP_DEG);
    expect(pointerAngleDeg(-1)).toBeCloseTo(POINTER_SWEEP_DEG);
  });
});

describe('turnTicks', () => {
  it('lists a tick at every whole turn from straight within full lock', () => {
    const expected5 = [-0.8, -0.4, 0, 0.4, 0.8];
    const ticks5 = turnTicks(5);
    expect(ticks5).toHaveLength(expected5.length);
    expected5.forEach((v, i) => expect(ticks5[i]).toBeCloseTo(v));

    const expected4 = [-1, -0.5, 0, 0.5, 1];
    const ticks4 = turnTicks(4);
    expect(ticks4).toHaveLength(expected4.length);
    expected4.forEach((v, i) => expect(ticks4[i]).toBeCloseTo(v));
  });

  it('rotates the rim by whole turns at every tick', () => {
    for (const steer of turnTicks(TURNS)) {
      const turns = rimRotationDeg(steer, TURNS) / 360;
      expect(Math.abs(turns - Math.round(turns))).toBeLessThan(1e-9);
    }
  });
});

describe('stepReset', () => {
  it('ramps to 0 at the given rate, then stops', () => {
    const s = createInputState();
    s.steer = 0.25;
    s.resetting = true;
    stepReset(s, 0.5, 0.25);
    expect(s.steer).toBeCloseTo(0.125);
    expect(s.resetting).toBe(true);
    stepReset(s, 0.5, 0.25);
    expect(s.steer).toBe(0);
    expect(s.resetting).toBe(false);
  });

  it('ramps a negative steer up toward 0', () => {
    const s = createInputState();
    s.steer = -0.25;
    s.resetting = true;
    stepReset(s, 0.5, 0.25);
    expect(s.steer).toBeCloseTo(-0.125);
    expect(s.resetting).toBe(true);
    stepReset(s, 0.5, 0.25);
    expect(s.steer).toBe(0);
    expect(s.resetting).toBe(false);
  });

  it('leaves the steer alone when no reset is pending', () => {
    const s = createInputState();
    s.steer = 0.25;
    stepReset(s, 0.5, 0.25);
    expect(s.steer).toBe(0.25);
    expect(s.resetting).toBe(false);
  });
});
