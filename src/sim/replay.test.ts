import { describe, expect, it } from 'vitest';
import type { InputLog } from '../contracts/exercise';
import type { ContactQuery, ControlVector, SimSnapshot, StartState } from '../contracts/sim';
import { resolveCombination } from '../vehicles/resolve';
import { trailerById, truckById } from '../vehicles/registry';
import {
  createInputRecorder,
  createReplayCursor,
  MAX_REPLAY_STEPS,
  parseInputLog,
  replaySnapshots,
  serializeInputLog,
} from './replay';
import { createSimulation } from './simulation';

const params = resolveCombination(
  truckById('man-le-18-280'),
  trailerById('hueffermann-hpa-24-81-l'),
);
const start: StartState = { truck: { x: 3, y: -2, heading: 0.4 }, couplingAngle: 0.05 };
const contacts: ContactQuery = (bodies) =>
  bodies.some((b) => b.obb.cy > 12)
    ? { body: 'truck', obstacleId: 'fence', point: { x: 0, y: 0 } }
    : null;
const meta = {
  layoutId: 'depot',
  exerciseId: 'reverse-bay',
  truckId: 'man-le-18-280',
  trailerId: 'hueffermann-hpa-24-81-l',
} as const;
const recorded = { ...meta, lighting: 'day' } as const;

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
    const log = recorder.finish(recorded, sim.snapshot().step);
    expect(log.steps).toBe(1800);
    const replayed = replaySnapshots(log, createSimulation(params, start, contacts));
    expect(replayed).toEqual(live);
  });

  it('scrubbing to a step yields the state playing reaches', () => {
    const sim = createSimulation(params, start, contacts);
    const recorder = createInputRecorder();
    for (let i = 0; i < 1800; i++) {
      const control = script(i);
      recorder.record(sim.snapshot().step, control);
      sim.step(control);
    }
    const log = recorder.finish(recorded, sim.snapshot().step);
    const makeSim = () => createSimulation(params, start, contacts);
    const played = replaySnapshots(log, makeSim());
    let observed = 0;
    const cursor = createReplayCursor(log, makeSim, () => {
      observed = 0;
      return () => observed++;
    });
    for (const step of [900, 1799, 300, 301, 1500, 20, 1800, 650, 5000, -3]) {
      const target = Math.min(Math.max(step, 0), 1800);
      const snapshot = cursor.seek(step);
      expect(cursor.step()).toBe(target);
      expect(snapshot).toEqual(target === 0 ? makeSim().snapshot() : played[target - 1]);
      expect(observed).toBe(target);
    }
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
    expect(recorder.finish(recorded, 5).changes).toEqual([
      { step: 0, control: a },
      { step: 2, control: b },
      { step: 4, control: a },
    ]);
  });

  it('stops recording at the replay limit', () => {
    const recorder = createInputRecorder();
    const a = ctl({ lever: 1 });
    recorder.record(0, a);
    recorder.record(MAX_REPLAY_STEPS, ctl({ gear: 'R' }));
    const log = recorder.finish(recorded, MAX_REPLAY_STEPS + 10);
    expect(log.changes).toEqual([{ step: 0, control: a }]);
    expect(log.steps).toBe(MAX_REPLAY_STEPS);
  });

  it('rejects malformed logs', () => {
    const valid: InputLog = {
      version: 2,
      ...recorded,
      steps: 10,
      changes: [
        { step: 0, control: ctl({ lever: 1 }) },
        { step: 4, control: ctl({ lever: 1, brake: true }) },
      ],
    };
    const fingerprint = (): string => 'data-a';
    const json = (o: object): string => JSON.stringify({ ...o, fingerprint: 'data-a' });
    const parse = (raw: string | null) => parseInputLog(raw, fingerprint);
    expect(parse(null)).toBeNull();
    expect(parse('[]')).toBeNull();
    expect(parse('not json')).toBeNull();
    expect(parse(json({ ...valid, version: 3 }))).toBeNull();
    expect(parse(json({ ...valid, lighting: 'dusk' }))).toBeNull();
    expect(parse(json({ ...valid, lighting: undefined }))).toBeNull();
    expect(parse(json({ ...valid, truckId: 'scania-r' }))).toBeNull();
    expect(parse(json({ ...valid, steps: -1 }))).toBeNull();
    expect(parse(json({ ...valid, changes: [...valid.changes].reverse() }))).toBeNull();
    expect(parse(json(valid))).toEqual(valid);
    expect(parse(json({ ...valid, exerciseId: null }))).toEqual({
      ...valid,
      exerciseId: null,
    });
  });

  it('round-trips lighting and reads a version 1 log as day', () => {
    const fingerprint = (): string => 'data-a';
    const night: InputLog = { version: 2, ...meta, lighting: 'night', steps: 10, changes: [] };
    expect(parseInputLog(serializeInputLog(night, fingerprint), fingerprint)).toEqual(night);
    const v1 = JSON.stringify({
      version: 1,
      ...meta,
      steps: 10,
      changes: [],
      fingerprint: 'data-a',
    });
    expect(parseInputLog(v1, fingerprint)).toEqual({ ...night, lighting: 'day' });
    const v1Night = JSON.stringify({
      version: 1,
      ...meta,
      lighting: 'night',
      steps: 10,
      changes: [],
      fingerprint: 'data-a',
    });
    expect(parseInputLog(v1Night, fingerprint)?.lighting).toBe('day');
  });

  it('accepts a log only for the data that produced it', () => {
    const valid: InputLog = { version: 2, ...recorded, steps: 10, changes: [] };
    const seen: unknown[] = [];
    const fingerprint = (ids: unknown): string => {
      seen.push(ids);
      return 'data-a';
    };
    expect(parseInputLog(JSON.stringify({ ...valid, fingerprint: 'data-a' }), fingerprint)).toEqual(
      valid,
    );
    expect(seen).toEqual([meta]);
    expect(
      parseInputLog(JSON.stringify({ ...valid, fingerprint: 'data-b' }), fingerprint),
    ).toBeNull();
    expect(parseInputLog(JSON.stringify(valid), fingerprint)).toBeNull();
  });
});
