import { describe, expect, it } from 'vitest';
import * as scoring from '../scoring/score';
import { GATE_HINT, GATE_PAIRS, GATE_PASS, GATE_TIMEOUT, runGate } from './gate-harness';

describe('reverse-bay gate', () => {
  it.each(GATE_PAIRS)(
    '$truck with $trailer',
    ({ truck, trailer }) => {
      const outcome = runGate('reverse-bay', truck, trailer, scoring);
      expect(outcome, GATE_HINT).toEqual({ ...outcome, ...GATE_PASS });
    },
    GATE_TIMEOUT,
  );
});
