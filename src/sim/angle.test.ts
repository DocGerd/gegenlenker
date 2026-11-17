import { describe, expect, it } from 'vitest';
import { wrapAngle } from './angle';

const f64 = new Float64Array(1);
const u64 = new BigUint64Array(f64.buffer);

/** Steps a positive double by `n` ulps. */
function stepUlps(a: number, n: number): number {
  f64[0] = a;
  u64[0] = (u64[0] ?? 0n) + BigInt(n);
  return f64[0];
}

describe('wrapAngle', () => {
  it('maps ±π to π', () => {
    expect(wrapAngle(Math.PI)).toBe(Math.PI);
    expect(wrapAngle(-Math.PI)).toBe(Math.PI);
  });

  it('stays in (−π, π] within a few ulps of odd multiples of π', () => {
    for (let k = 1; k <= 11; k += 2) {
      for (const sign of [1, -1]) {
        const centre = k * Math.PI;
        for (let n = -60; n <= 60; n++) {
          const r = wrapAngle(sign * stepUlps(centre, n));
          expect(r).toBeGreaterThan(-Math.PI);
          expect(r).toBeLessThanOrEqual(Math.PI);
        }
      }
    }
  });
});
