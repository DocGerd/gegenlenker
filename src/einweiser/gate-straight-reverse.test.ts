import { describe, expect, it } from 'vitest';
import { createEinweiserTracker } from '../scoring/einweiser';
import * as score from '../scoring/score';
import { GATE_HINT, GATE_PAIRS, GATE_PASS, GATE_TIMEOUT, runGate } from './gate-harness';

describe('straight-reverse gate', () => {
  it.each(GATE_PAIRS)(
    '$truck with $trailer',
    ({ truck, trailer }) => {
      const outcome = runGate('straight-reverse', truck, trailer, {
        ...score,
        createEinweiserTracker,
      });
      expect(outcome, GATE_HINT).toEqual({ ...outcome, ...GATE_PASS });
    },
    GATE_TIMEOUT,
  );
});
