import { describe, expect, it } from 'vitest';
import { resolveRun } from '../content/run';
import type { ControlSource } from '../contracts/control';
import type { InputLog } from '../contracts/exercise';
import type { ControlVector, SimSnapshot } from '../contracts/sim';
import { runStartStep } from '../scoring/replay-events';
import type { RunTracker } from '../scoring/score';
import { DT } from '../sim/constants';
import { createInputRecorder, replaySnapshots } from '../sim/replay';
import { createSimulation } from '../sim/simulation';
import { createRunStepper, type RunHooks } from './run-stepper';

const ids = {
  layoutId: 'depot',
  exerciseId: 'slalom',
  truckId: 'man-le-18-280',
  trailerId: 'krone-azw-18',
  role: 'driver',
} as const;

const IDLE: ControlVector = { steer: 0, lever: 0, brake: false, gear: 'P' };
const DRIVE: ControlVector = { steer: 0, lever: 0.5, brake: false, gear: 'D' };

/** `at(step)` is the control the source reports for the step about to run. */
function scripted(at: (step: number) => ControlVector): ControlSource {
  let current = IDLE;
  return {
    tick: (_dt, s) => {
      current = at(s.step);
    },
    control: () => current,
    lamps: () => ({ lights: false, hazard: false }),
  };
}

const tracker = (reachedAt: (s: SimSnapshot) => boolean): RunTracker => ({
  update: reachedAt,
  goal: () => 'away',
  goalCue: () => ({ state: 'away', distance: 0, positionOk: false, angleOk: false }),
  waypointVisited: () => true,
});

function setup(t: RunTracker | null, hooks: RunHooks | null = null) {
  const { params, exercise, start, contacts } = resolveRun(ids);
  if (exercise === null) throw new Error('exercise expected');
  const recorder = createInputRecorder();
  const stepper = createRunStepper(createSimulation(params, start, contacts), recorder, t, hooks);
  const result = () => stepper.result(exercise, ids.truckId, ids.trailerId, 'day', false);
  return { stepper, recorder, result };
}

describe('run clock', () => {
  it('starts at the first driving input, not before', () => {
    const { stepper, result } = setup(null);
    const source = scripted((step) => (step < 10 ? IDLE : DRIVE));
    stepper.advance(5, source, false);
    expect(stepper.startTime()).toBeNull();
    const snapshot = stepper.advance(20, source, false);
    expect(stepper.startTime()).toBeCloseTo(10 * DT, 12);
    expect(result().time).toBeCloseTo(snapshot.time - 10 * DT, 12);
  });

  it('agrees with runStartStep on the recorded log', () => {
    const { stepper, recorder } = setup(null);
    const snapshot = stepper.advance(
      30,
      scripted((step) => (step < 12 ? IDLE : DRIVE)),
      false,
    );
    const log = recorder.finish({ ...ids, lighting: 'day', mirrorsOnly: false }, snapshot.step);
    expect(runStartStep(log)).toBe(12);
    expect(stepper.startTime()).toBeCloseTo(runStartStep(log) * DT, 12);
  });

  it('reproduces the replayed snapshots of its own log', () => {
    const { params, start, contacts } = resolveRun(ids);
    const { stepper, recorder } = setup(null);
    const last = stepper.advance(
      50,
      scripted((step) => (step < 12 ? IDLE : { ...DRIVE, steer: step < 30 ? 0.3 : -0.2 })),
      false,
    );
    const log: InputLog = recorder.finish(
      { ...ids, lighting: 'day', mirrorsOnly: false },
      last.step,
    );
    const replayed = replaySnapshots(log, createSimulation(params, start, contacts));
    expect(replayed.at(-1)).toEqual(last);
  });
});

describe('assisted', () => {
  it('ignores an aid on before the first driving input', () => {
    const { stepper, result } = setup(null);
    stepper.advance(
      10,
      scripted(() => IDLE),
      true,
    );
    stepper.advance(
      10,
      scripted(() => DRIVE),
      false,
    );
    expect(result().assisted).toBe(false);
  });

  it('counts an aid on after the first driving input and stays set when it goes off', () => {
    const { stepper, result } = setup(null);
    const source = scripted(() => DRIVE);
    stepper.advance(5, source, false);
    expect(result().assisted).toBe(false);
    stepper.advance(1, source, true);
    stepper.advance(20, source, false);
    expect(result().assisted).toBe(true);
  });
});

describe('reaching the target', () => {
  it('stops on the reaching step so it is drawn before exit', () => {
    const { stepper, result } = setup(tracker((s) => s.step >= 7));
    const snapshot = stepper.advance(
      100,
      scripted(() => DRIVE),
      false,
    );
    expect(snapshot.step).toBe(7);
    expect(stepper.over()).toBe(true);
    expect(result().reached).toBe(true);
  });

  it('keeps running while the target is not reached', () => {
    const { stepper, result } = setup(tracker(() => false));
    const snapshot = stepper.advance(
      40,
      scripted(() => DRIVE),
      false,
    );
    expect(snapshot.step).toBe(40);
    expect(stepper.over()).toBe(false);
    expect(result().reached).toBe(false);
  });
});

describe('Einweiser hooks', () => {
  const hooks = (over: Partial<RunHooks> & { settled?: number[] }): RunHooks => ({
    settle: (s) => over.settled?.push(s.step),
    runOver: () => false,
    halted: () => true,
    ...over,
  });

  it('settles every step', () => {
    const settled: number[] = [];
    const { stepper } = setup(null, hooks({ settled }));
    stepper.advance(
      3,
      scripted(() => DRIVE),
      false,
    );
    expect(settled).toEqual([1, 2, 3]);
  });

  it('ends the run on the hit, reached or not', () => {
    let step = 0;
    const { stepper, result } = setup(
      tracker((s) => s.step >= 4),
      hooks({ settle: (s) => (step = s.step), runOver: () => step >= 4 }),
    );
    const snapshot = stepper.advance(
      100,
      scripted(() => DRIVE),
      false,
    );
    expect(snapshot.step).toBe(4);
    expect(stepper.over()).toBe(true);
    expect(stepper.runOver()).toBe(true);
    expect(result().reached).toBe(false);
  });

  it('reaches only once a Halt is recognised', () => {
    let step = 0;
    const { stepper, result } = setup(
      tracker(() => true),
      hooks({ settle: (s) => (step = s.step), halted: () => step >= 6 }),
    );
    const snapshot = stepper.advance(
      100,
      scripted(() => DRIVE),
      false,
    );
    expect(snapshot.step).toBe(6);
    expect(result().reached).toBe(true);
    expect(stepper.runOver()).toBe(false);
  });
});
