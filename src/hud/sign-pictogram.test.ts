import { describe, expect, it } from 'vitest';
import { SIGN_POSES } from '../einweiser/sign-poses';
import { armLines } from './sign-pictogram';

const hand = (sign: 'achtung' | 'rechts', side: 0 | 1) => {
  const key = SIGN_POSES[sign].keys[0];
  if (key === undefined) throw new Error(`${sign} has a key`);
  const point = armLines(key)[side]?.[2];
  if (point === undefined) throw new Error('an arm ends in a hand');
  return point;
};

describe('armLines', () => {
  // the driver faces him: his right arm stands on the viewer's left
  it('draws his raised right arm (Achtung) on the viewer’s left, above his head', () => {
    const right = hand('achtung', 1);
    expect(right.x).toBeLessThan(0);
    expect(right.y).toBeGreaterThan(1.9);
  });

  it('draws the arm of Rechts fahren out to the viewer’s left, the other hanging', () => {
    expect(hand('rechts', 1).x).toBeLessThan(-0.6);
    expect(hand('rechts', 0).y).toBeLessThan(1);
  });
});
