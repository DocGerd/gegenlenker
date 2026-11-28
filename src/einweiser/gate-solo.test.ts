import { describe, expect, it } from 'vitest';
import { createEinweiserTracker } from '../scoring/einweiser';
import * as score from '../scoring/score';
import { GATE_HINT, GATE_PASS, GATE_SOLO, GATE_TIMEOUT, runGate } from './gate-harness';

describe('solo gate', () => {
  it.each(GATE_SOLO)(
    '$exercise with $truck solo',
    ({ exercise, truck }) => {
      const outcome = runGate(exercise, truck, null, { ...score, createEinweiserTracker });
      expect(outcome, GATE_HINT).toEqual({ ...outcome, ...GATE_PASS });
    },
    GATE_TIMEOUT,
  );
});
