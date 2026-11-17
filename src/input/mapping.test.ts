import { describe, expect, it } from 'vitest';
import { createInputState, rimRotationDeg, steerDisplay, stepReset, turnTicks } from './mapping';

const TURNS = 5;
/** Steer value whose wheel rotation is `deg`. */
const steerAt = (deg: number): number => deg / (TURNS * 180);
const centred = (deg: number, prev: boolean): boolean =>
  steerDisplay(steerAt(deg), steerAt(deg), TURNS, prev).centred;

describe('steerDisplay', () => {
  it('does not read a full turn from straight as centred', () => {
    const oneTurn = 2 / TURNS;
    expect(steerDisplay(oneTurn, oneTurn, TURNS, false).centred).toBe(false);
    expect(steerDisplay(oneTurn, oneTurn, TURNS, true).centred).toBe(false);
  });

  it('enters inside 6 degrees and leaves beyond 8', () => {
    expect(centred(5.9, false)).toBe(true);
    expect(centred(6.1, false)).toBe(false);
    expect(centred(7.9, true)).toBe(true);
    expect(centred(8.1, true)).toBe(false);
  });
});

describe('turnTicks', () => {
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
});
