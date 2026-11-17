import { describe, expect, it } from 'vitest';
import { arrow, numberMarkings } from './markings';

const SEGMENT_COUNTS = [6, 2, 5, 5, 4, 5, 6, 3, 7, 6];

describe('numberMarkings', () => {
  it('draws the segments of each digit', () => {
    SEGMENT_COUNTS.forEach((count, digit) => {
      expect(numberMarkings(String(digit), 'dock-number', 0, 0, 1)).toHaveLength(count);
    });
    expect(numberMarkings('14', 'dock-number', 0, 0, 1)).toHaveLength(2 + 4);
  });
});

describe('arrow', () => {
  it('puts the tip ahead of the tail and the barbs back towards it, one per side', () => {
    const tail = { x: 2, y: 3 };
    const heading = 0.7;
    const length = 5;
    const tip = {
      x: tail.x + length * Math.cos(heading),
      y: tail.y + length * Math.sin(heading),
    };
    const [shaft, ...barbs] = arrow(tail.x, tail.y, heading, length);
    expect(shaft?.from).toEqual(tail);
    expect(shaft?.to.x).toBeCloseTo(tip.x);
    expect(shaft?.to.y).toBeCloseTo(tip.y);
    expect(barbs).toHaveLength(2);
    const sides = barbs.map((barb) => {
      expect(barb.from.x).toBeCloseTo(tip.x);
      expect(barb.from.y).toBeCloseTo(tip.y);
      const dx = barb.to.x - tip.x;
      const dy = barb.to.y - tip.y;
      expect(dx * Math.cos(heading) + dy * Math.sin(heading)).toBeLessThan(0);
      return Math.sign(-dx * Math.sin(heading) + dy * Math.cos(heading));
    });
    expect(sides.slice().sort()).toEqual([-1, 1]);
  });
});
