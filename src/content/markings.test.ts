import { describe, expect, it } from 'vitest';
import { numberMarkings } from './markings';

describe('numberMarkings', () => {
  it('draws the segments of each digit', () => {
    expect(numberMarkings('8', 'dock-number', 0, 0, 1)).toHaveLength(7);
    expect(numberMarkings('1', 'dock-number', 0, 0, 1)).toHaveLength(2);
    expect(numberMarkings('14', 'dock-number', 0, 0, 1)).toHaveLength(2 + 4);
  });

  it('knows every digit', () => {
    for (const d of '0123456789') {
      expect(numberMarkings(d, 'dock-number', 0, 0, 1).length).toBeGreaterThan(1);
    }
  });
});
