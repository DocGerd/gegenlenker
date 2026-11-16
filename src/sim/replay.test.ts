import { describe, expect, it } from 'vitest';
import type { InputLog } from '../contracts/exercise';
import type { ContactQuery, ControlVector, SimSnapshot, StartState } from '../contracts/sim';
import { resolveCombination } from '../vehicles/resolve';
import { trailerById, truckById } from '../vehicles/registry';
import { createInputRecorder, parseInputLog, replaySnapshots } from './replay';
import { createSimulation } from './simulation';

const params = resolveCombination(
  truckById('man-le-18-280'),
  trailerById('hueffermann-hpa-24-81-l'),
);
const start: StartState = { truck: { x: 3, y: -2, heading: 0.4 }, couplingAngle: 0.05 };
const contacts: ContactQuery = (bodies) =>
  bodies.some((b) => b.obb.cy > 12) ? { body: 'truck', obstacleId: 'fence' } : null;
const meta = {
  layoutId: 'depot',
  exerciseId: 'reverse-bay',
  truckId: 'man-le-18-280',
  trailerId: 'hueffermann-hpa-24-81-l',
} as const;

const ctl = (c: Partial<ControlVector>): ControlVector => ({
  steer: 0,
  lever: 0,
  brake: false,
  gear: 'D',
  ...c,
});

const script = (i: number): ControlVector => {
  if (i < 300) return ctl({ steer: 0.3, lever: 1 });
  if (i < 600) return ctl({ steer: -0.5 + i / 2000, lever: 0.8 });
  if (i < 700) return ctl({ steer: -0.5, lever: 0.8, brake: true });
  if (i < 1100) return ctl({ steer: 1, lever: 0.7, gear: 'R' });
  if (i < 1300) return ctl({ steer: -0.2, lever: 0.7, gear: 'N' });
  if (i < 1500) return ctl({ steer: -1, lever: 0.4 });
  return ctl({ lever: 0.4, gear: 'P' });
};

describe('replay', () => {
  it('a run replays identically from its input log', () => {
    const sim = createSimulation(params, start, contacts);
    const recorder = createInputRecorder();
    const live: SimSnapshot[] = [];
    for (let i = 0; i < 1800; i++) {
      const control = script(i);
      recorder.record(sim.snapshot().step, control);
      live.push(sim.step(control));
    }
    const log = recorder.finish(meta, sim.snapshot().step);
    expect(log.steps).toBe(1800);
    const replayed = replaySnapshots(log, createSimulation(params, start, contacts));
    expect(replayed).toEqual(live);
  });

  it('stores only control changes', () => {
    const recorder = createInputRecorder();
    const a = ctl({ steer: 0.2, lever: 1 });
    const b = ctl({ steer: 0.2, lever: 1, gear: 'R' });
    recorder.record(0, a);
    recorder.record(1, { ...a });
    recorder.record(2, b);
    recorder.record(3, { ...b });
    recorder.record(4, a);
    expect(recorder.finish(meta, 5).changes).toEqual([
      { step: 0, control: a },
      { step: 2, control: b },
      { step: 4, control: a },
    ]);
  });

  it('rejects malformed logs', () => {
    const valid: InputLog = {
      version: 1,
      ...meta,
      steps: 10,
      changes: [
        { step: 0, control: ctl({ lever: 1 }) },
        { step: 4, control: ctl({ lever: 1, brake: true }) },
      ],
    };
    const json = (o: unknown): string => JSON.stringify(o);
    expect(parseInputLog(null)).toBeNull();
    expect(parseInputLog('[]')).toBeNull();
    expect(parseInputLog('not json')).toBeNull();
    expect(parseInputLog(json({ ...valid, version: 2 }))).toBeNull();
    expect(parseInputLog(json({ ...valid, truckId: 'scania-r' }))).toBeNull();
    expect(parseInputLog(json({ ...valid, steps: -1 }))).toBeNull();
    expect(parseInputLog(json({ ...valid, changes: [...valid.changes].reverse() }))).toBeNull();
    expect(parseInputLog(json(valid))).toEqual(valid);
    expect(parseInputLog(json({ ...valid, exerciseId: null }))).toEqual({
      ...valid,
      exerciseId: null,
    });
  });
});
