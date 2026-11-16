import { describe, expect, it } from 'vitest';
import { gaugeLevel } from './gauges';

describe('gaugeLevel', () => {
  const limit = 2;

  it.each([
    [0, 'ok'],
    [0.59, 'ok'],
    [0.6, 'warn'],
    [0.84, 'warn'],
    [0.85, 'danger'],
    [1, 'danger'],
  ] as const)('ratio %f is %s', (ratio, level) => {
    expect(gaugeLevel(ratio * limit, limit)).toBe(level);
    expect(gaugeLevel(-ratio * limit, limit)).toBe(level);
  });
});
