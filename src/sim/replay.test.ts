import { describe, expect, it } from 'vitest';
import type { EinweiserTrack, InputLog } from '../contracts/exercise';
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
const ids = {
  layoutId: 'depot',
  exerciseId: 'reverse-bay',
  truckId: 'man-le-18-280',
  trailerId: 'hueffermann-hpa-24-81-l',
} as const;
const meta = { ...ids, role: 'driver' } as const;
const recorded = { ...meta, lighting: 'day', mirrorsOnly: false } as const;

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
      version: 4,
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
    expect(parse(json({ ...valid, version: 5 }))).toBeNull();
    expect(parse(json({ ...valid, role: undefined }))).toBeNull();
    expect(parse(json({ ...valid, role: 'pilot' }))).toBeNull();
    expect(parse(json({ ...valid, lighting: 'dusk' }))).toBeNull();
    expect(parse(json({ ...valid, lighting: undefined }))).toBeNull();
    expect(parse(json({ ...valid, mirrorsOnly: undefined }))).toBeNull();
    expect(parse(json({ ...valid, mirrorsOnly: 'yes' }))).toBeNull();
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
    const night: InputLog = {
      version: 4,
      ...meta,
      lighting: 'night',
      mirrorsOnly: false,
      steps: 10,
      changes: [],
    };
    expect(parseInputLog(serializeInputLog(night, fingerprint), fingerprint)).toEqual(night);
    const v1 = JSON.stringify({
      version: 1,
      ...ids,
      steps: 10,
      changes: [],
      fingerprint: 'data-a',
    });
    expect(parseInputLog(v1, fingerprint)).toEqual({ ...night, lighting: 'day' });
    const v1Night = JSON.stringify({
      version: 1,
      ...ids,
      lighting: 'night',
      steps: 10,
      changes: [],
      fingerprint: 'data-a',
    });
    expect(parseInputLog(v1Night, fingerprint)?.lighting).toBe('day');
  });

  it('round-trips a mirror-only run and reads an older log as driven with the top view', () => {
    const fingerprint = (): string => 'data-a';
    const mirrors: InputLog = {
      version: 4,
      ...recorded,
      mirrorsOnly: true,
      steps: 10,
      changes: [],
    };
    expect(parseInputLog(serializeInputLog(mirrors, fingerprint), fingerprint)).toEqual(mirrors);
    const v2 = JSON.stringify({
      version: 2,
      ...ids,
      lighting: 'day',
      mirrorsOnly: true,
      steps: 10,
      changes: [],
      fingerprint: 'data-a',
    });
    expect(parseInputLog(v2, fingerprint)).toEqual({ ...mirrors, mirrorsOnly: false });
  });

  it('reads a version 3 log as driven, with its view and lighting', () => {
    const fingerprint = (): string => 'data-a';
    const v3 = {
      version: 3,
      ...ids,
      lighting: 'night',
      mirrorsOnly: true,
      steps: 10,
      changes: [{ step: 0, control: ctl({ lever: 1 }) }],
    } as const;
    const parsed = parseInputLog(JSON.stringify({ ...v3, fingerprint: 'data-a' }), fingerprint);
    if (parsed === null) throw new Error('log expected');
    expect(parsed).toEqual({ ...v3, version: 4, role: 'driver' });
    expect('einweiser' in parsed).toBe(false);
    expect(parseInputLog(serializeInputLog(parsed, fingerprint), fingerprint)).toEqual(parsed);
    const tagged = JSON.stringify({ ...v3, role: 'einweiser', fingerprint: 'data-a' });
    expect(parseInputLog(tagged, fingerprint)?.role).toBe('driver');
  });

  it('round-trips an Einweiser log and its track, and checks the track', () => {
    const fingerprint = (): string => 'data-a';
    const sample = { step: 0, x: 4, y: -3.5, heading: 1.2, pitch: -0.1 };
    const track: EinweiserTrack = {
      samples: [sample, { ...sample, step: 6, x: 4.01, heading: 1.25 }],
      signs: [
        { step: 0, sign: 'achtung' },
        { step: 40, sign: 'herkommen' },
        { step: 90, sign: null },
      ],
    };
    const log: InputLog = {
      version: 4,
      ...recorded,
      role: 'einweiser',
      einweiser: track,
      steps: 100,
      changes: [{ step: 50, control: ctl({ lever: 0.3, gear: 'R' }) }],
    };
    const parse = (o: object) =>
      parseInputLog(JSON.stringify({ ...o, fingerprint: 'data-a' }), fingerprint);
    const withTrack = (t: object) => parse({ ...log, einweiser: { ...track, ...t } });
    expect(parseInputLog(serializeInputLog(log, fingerprint), fingerprint)).toEqual(log);
    expect(parse({ ...log, einweiser: undefined })).toBeNull();
    expect(parse({ ...log, role: 'driver' })).toBeNull();
    expect(withTrack({ signs: [{ step: 0, sign: 'winken' }] })).toBeNull();
    expect(withTrack({ signs: [...track.signs].reverse() })).toBeNull();
    expect(withTrack({ samples: [{ ...sample, pitch: Number.NaN }] })).toBeNull();
    expect(withTrack({ samples: [{ ...sample, step: 0.5 }] })).toBeNull();
    expect(withTrack({ samples: undefined })).toBeNull();
    expect(withTrack({ samples: [] })).toBeNull();
    expect(withTrack({ signs: [] })).toEqual({ ...log, einweiser: { ...track, signs: [] } });
  });

  it('round-trips a solo run, which only a driver drives', () => {
    const fingerprint = (): string => 'data-a';
    const solo: InputLog = { version: 4, ...recorded, trailerId: null, steps: 10, changes: [] };
    const parse = (o: object) =>
      parseInputLog(JSON.stringify({ ...o, fingerprint: 'data-a' }), fingerprint);
    expect(parseInputLog(serializeInputLog(solo, fingerprint), fingerprint)).toEqual(solo);
    expect(parse({ ...solo, trailerId: 'none' })).toBeNull();
    expect(parse({ ...solo, trailerId: undefined })).toBeNull();
    expect(parse({ ...solo, version: 3, trailerId: ids.trailerId })).not.toBeNull();
    expect(parse({ ...solo, version: 3 })).toBeNull();
    const einweiser = {
      role: 'einweiser',
      einweiser: { samples: [{ step: 0, x: 0, y: 0, heading: 0, pitch: 0 }], signs: [] },
    };
    expect(parse({ ...solo, ...einweiser, trailerId: ids.trailerId })).not.toBeNull();
    expect(parse({ ...solo, ...einweiser })).toBeNull();
  });

  it('accepts a log only for the data that produced it', () => {
    const valid: InputLog = { version: 4, ...recorded, steps: 10, changes: [] };
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
