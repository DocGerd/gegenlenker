import { EXERCISE_IDS, type InputLog } from '../contracts/exercise';
import { LAYOUT_IDS } from '../contracts/layout';
import type { ControlVector, Gear, InputChange, Simulation, SimSnapshot } from '../contracts/sim';
import { TRAILER_IDS, TRUCK_IDS } from '../contracts/vehicle';

const GEARS: readonly Gear[] = ['P', 'R', 'N', 'D'];

// Bounds a log's size and the snapshots a replay computes; a corrupt or hostile `steps` must not exhaust memory.
export const MAX_REPLAY_STEPS = 72_000;

export type RunIds = Pick<InputLog, 'layoutId' | 'exerciseId' | 'truckId' | 'trailerId'>;

export type InputRecorder = {
  record(step: number, control: ControlVector): void;
  finish(meta: RunIds, steps: number): InputLog;
};

const sameControl = (a: ControlVector, b: ControlVector): boolean =>
  a.steer === b.steer && a.lever === b.lever && a.brake === b.brake && a.gear === b.gear;

const copyControl = ({ steer, lever, brake, gear }: ControlVector): ControlVector => ({
  steer,
  lever,
  brake,
  gear,
});

export function createInputRecorder(): InputRecorder {
  const changes: InputChange[] = [];
  let last: ControlVector | null = null;
  return {
    record(step, control) {
      if (step >= MAX_REPLAY_STEPS) return;
      if (last !== null && sameControl(last, control)) return;
      last = copyControl(control);
      changes.push({ step, control: last });
    },
    finish(meta, steps) {
      return {
        version: 1,
        ...meta,
        steps: Math.min(steps, MAX_REPLAY_STEPS),
        changes: [...changes],
      };
    },
  };
}

export function replaySnapshots(log: InputLog, sim: Simulation): SimSnapshot[] {
  const snapshots: SimSnapshot[] = [];
  let control = sim.snapshot().control;
  let next = 0;
  for (let i = 0; i < log.steps; i++) {
    for (let change = log.changes[next]; change !== undefined && change.step <= i;) {
      control = change.control;
      change = log.changes[++next];
    }
    snapshots.push(sim.step(control));
  }
  return snapshots;
}

const isMember = <T extends string>(ids: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (ids as readonly string[]).includes(v);

const isStep = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function parseControl(v: unknown): ControlVector | null {
  if (!isRecord(v)) return null;
  const { steer, lever, brake, gear } = v;
  if (typeof steer !== 'number' || !Number.isFinite(steer)) return null;
  if (typeof lever !== 'number' || !Number.isFinite(lever)) return null;
  if (typeof brake !== 'boolean' || !isMember(GEARS, gear)) return null;
  return { steer, lever, brake, gear };
}

export function serializeInputLog(log: InputLog, fingerprint: (ids: RunIds) => string): string {
  return JSON.stringify({ ...log, fingerprint: fingerprint(log) });
}

/** Null unless the log was stored for the data `fingerprint` now reports for its ids. */
export function parseInputLog(
  raw: string | null,
  fingerprint: (ids: RunIds) => string,
): InputLog | null {
  if (raw === null) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data) || data.version !== 1) return null;
  const { layoutId, exerciseId, truckId, trailerId, steps, changes } = data;
  if (!isMember(LAYOUT_IDS, layoutId) || !isMember(TRUCK_IDS, truckId)) return null;
  if (!isMember(TRAILER_IDS, trailerId) || !isStep(steps) || !Array.isArray(changes)) return null;
  if (exerciseId !== null && !isMember(EXERCISE_IDS, exerciseId)) return null;
  if (data.fingerprint !== fingerprint({ layoutId, exerciseId, truckId, trailerId })) return null;
  const parsed: InputChange[] = [];
  for (const change of changes as unknown[]) {
    if (!isRecord(change)) return null;
    const control = parseControl(change.control);
    const prev = parsed[parsed.length - 1];
    if (control === null || !isStep(change.step)) return null;
    if (prev !== undefined && change.step <= prev.step) return null;
    parsed.push({ step: change.step, control });
  }
  return { version: 1, layoutId, exerciseId, truckId, trailerId, steps, changes: parsed };
}
