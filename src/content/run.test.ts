import { describe, expect, it } from 'vitest';
import type { InputLog, RunResult } from '../contracts/exercise';
import type { ControlVector } from '../contracts/sim';
import { createRunTracker, runResult } from '../scoring/score';
import { SIM_REVISION } from '../sim/fingerprint';
import { createReplayCursor } from '../sim/replay';
import { createSimulation } from '../sim/simulation';
import { resolveRun } from './run';

const ctl = (c: Partial<ControlVector>): ControlVector => ({
  steer: 0,
  lever: 0,
  brake: false,
  gear: 'D',
  ...c,
});

const FIXED_LOG = {
  version: 3,
  lighting: 'day',
  mirrorsOnly: false,
  steps: 2400,
  changes: [
    { step: 0, control: ctl({ steer: 0.4, lever: 0.8 }) },
    { step: 400, control: ctl({ steer: -0.5, lever: 0.6, gear: 'R' }) },
    { step: 1200, control: ctl({ steer: 0.7, lever: 0.6, gear: 'R' }) },
    { step: 1800, control: ctl({ steer: 0, lever: 0.8, gear: 'D' }) },
  ],
} as const satisfies Partial<InputLog>;

const fnv = (text: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

function pinned(layoutId: 'depot' | 'logistics', exerciseId: 'slalom' | 'reverse-bay') {
  const log: InputLog = {
    ...FIXED_LOG,
    layoutId,
    exerciseId,
    truckId: 'man-le-18-280',
    trailerId: 'krone-azw-18',
  };
  const { params, exercise, start, contacts } = resolveRun(log);
  if (exercise === null) throw new Error('exercise expected');
  const tracker = createRunTracker(exercise);
  let reached = false;
  const cursor = createReplayCursor(
    log,
    () => createSimulation(params, start, contacts),
    () => (snapshot) => {
      reached = tracker.update(snapshot) || reached;
    },
  );
  const final = cursor.seek(log.steps);
  const result: RunResult = runResult(
    final,
    exercise,
    log.truckId,
    log.trailerId,
    reached,
    tracker.waypointVisited(),
    false,
    0,
    log.lighting,
    log.mirrorsOnly,
  );
  // Lighting and the view are outside the simulation: the digest pins behaviour, not what a run is tagged with.
  const tags = { lighting: undefined, mirrorsOnly: undefined };
  return { SIM_REVISION, digest: fnv(JSON.stringify([final, { ...result, ...tags }])) };
}

describe('run behaviour pin', () => {
  // A change here without a SIM_REVISION bump is a behaviour change that would keep stale stored runs.
  it('depot', () => {
    expect(pinned('depot', 'slalom')).toEqual({ SIM_REVISION: 2, digest: 'a5e46a57' });
  });

  it('logistics', () => {
    expect(pinned('logistics', 'reverse-bay')).toEqual({
      SIM_REVISION: 2,
      digest: 'cc0d1eb2',
    });
  });
});
