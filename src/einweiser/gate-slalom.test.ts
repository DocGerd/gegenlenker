import { describe, expect, it } from 'vitest';
import * as scoring from '../scoring/score';
import { GATE_PAIRS, GATE_TIMEOUT, runGate } from './gate-harness';

describe('slalom gate', () => {
  it.each(GATE_PAIRS)(
    '$truck with $trailer',
    ({ truck, trailer }) => {
      expect(runGate('slalom', truck, trailer, scoring)).toMatchObject({
        reached: true,
        faults: {},
        contacts: 0,
        jackknifes: 0,
      });
    },
    GATE_TIMEOUT,
  );
});
