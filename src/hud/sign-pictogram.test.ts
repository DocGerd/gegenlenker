import { describe, expect, it } from 'vitest';
import { SIGN_IDS } from '../contracts/einweiser';
import { handPoint, SIGN_POSES } from '../einweiser/sign-poses';
import { armLines, signPictogram, steerCue } from './sign-pictogram';

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

  it('ends every arm of every key at the hand the driver reads', () => {
    const facing = { x: 0, y: 0, heading: 0 };
    for (const sign of SIGN_IDS) {
      for (const key of SIGN_POSES[sign].keys) {
        const lines = armLines(key);
        (['left', 'right'] as const).forEach((side, i) => {
          const drawn = lines[i]?.[2];
          const read = handPoint(facing, key, side);
          expect(drawn?.x, `${sign} ${side}`).toBeCloseTo(read.y, 9);
          expect(drawn?.y, `${sign} ${side}`).toBeCloseTo(read.z, 9);
        });
      }
    }
  });
});

describe('steerCue', () => {
  it('marks each steering sign its own way and no other sign', () => {
    const steering = [
      'lenkenLinks',
      'lenkenLinksVoll',
      'lenkenGerade',
      'lenkenRechts',
      'lenkenRechtsVoll',
    ] as const;
    const cues = steering.map(steerCue);
    expect(new Set(cues).size).toBe(steering.length);
    for (const sign of SIGN_IDS.filter((s) => !(steering as readonly string[]).includes(s)))
      expect(steerCue(sign), sign).toBe('');
    // full lock sweeps the long way round
    expect(steerCue('lenkenLinksVoll')).toMatch(/A0\.32 0\.32 0 1 1/);
    expect(steerCue('lenkenRechts')).toMatch(/A0\.32 0\.32 0 0 0/);
    expect(new Set(SIGN_IDS.map(signPictogram)).size).toBe(SIGN_IDS.length);
  });
});
