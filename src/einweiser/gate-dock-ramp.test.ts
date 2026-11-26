import { describe, expect, it } from 'vitest';
import * as scoring from '../scoring/score';
import { GATE_PAIRS, GATE_TIMEOUT, runGate } from './gate-harness';

describe('dock-ramp gate', () => {
  it.each(GATE_PAIRS)(
    '$truck with $trailer',
    ({ truck, trailer }) => {
      expect(runGate('dock-ramp', truck, trailer, scoring)).toMatchObject({
        reached: true,
        faults: {},
        contacts: 0,
        jackknifes: 0,
      });
    },
    GATE_TIMEOUT,
  );
});
