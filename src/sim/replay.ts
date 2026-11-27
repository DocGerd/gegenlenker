import { SIGN_IDS } from '../contracts/einweiser';
import {
  EXERCISE_IDS,
  ROLES,
  type EinweiserSample,
  type EinweiserTrack,
  type InputLog,
} from '../contracts/exercise';
import { LAYOUT_IDS } from '../contracts/layout';
import { DEFAULT_LIGHTING, LIGHTING_MODES } from '../contracts/render';
import type { ControlVector, Gear, InputChange, Simulation, SimSnapshot } from '../contracts/sim';
import { TRAILER_IDS, TRUCK_IDS } from '../contracts/vehicle';

const GEARS: readonly Gear[] = ['P', 'R', 'N', 'D'];

// Bounds a log's size and the snapshots a replay computes; a corrupt or hostile `steps` must not exhaust memory.
export const MAX_REPLAY_STEPS = 72_000;

export type RunIds = Pick<InputLog, 'layoutId' | 'exerciseId' | 'truckId' | 'trailerId' | 'role'>;

export type RunMeta = RunIds & Pick<InputLog, 'lighting' | 'mirrorsOnly' | 'einweiser'>;

export type InputRecorder = {
  record(step: number, control: ControlVector): void;
  finish(meta: RunMeta, steps: number): InputLog;
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
        version: 4,
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

export type ReplayCursor = {
  /** Steps taken so far. */
  step(): number;
  snapshot(): SimSnapshot;
  /** Clamped to the run; going back rebuilds the run from step 0, so scrubbing equals playing. */
  seek(step: number): SimSnapshot;
};

/**
 * `makeObserver` runs on every rebuild, so state that depends on the whole history
 * (the scoring tracker) restarts together with the simulation.
 */
export function createReplayCursor(
  log: InputLog,
  makeSim: () => Simulation,
  makeObserver?: () => (snapshot: SimSnapshot) => void,
): ReplayCursor {
  let sim = makeSim();
  let observe = makeObserver?.();
  let snapshot = sim.snapshot();
  let stepped = 0;
  let next = 0;
  let control = snapshot.control;
  const reset = (): void => {
    sim = makeSim();
    observe = makeObserver?.();
    snapshot = sim.snapshot();
    stepped = 0;
    next = 0;
    control = snapshot.control;
  };
  return {
    step: () => stepped,
    snapshot: () => snapshot,
    seek(step) {
      const target = Math.min(Math.max(Math.floor(step), 0), log.steps);
      if (target < stepped) reset();
      while (stepped < target) {
        for (let change = log.changes[next]; change !== undefined && change.step <= stepped;) {
          control = change.control;
          change = log.changes[++next];
        }
        snapshot = sim.step(control);
        observe?.(snapshot);
        stepped++;
      }
      return snapshot;
    },
  };
}

const isMember = <T extends string>(ids: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (ids as readonly string[]).includes(v);

const isStep = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function parseControl(v: unknown): ControlVector | null {
  if (!isRecord(v)) return null;
  const { steer, lever, brake, gear } = v;
  if (!isFiniteNumber(steer) || !isFiniteNumber(lever)) return null;
  if (typeof brake !== 'boolean' || !isMember(GEARS, gear)) return null;
  return { steer, lever, brake, gear };
}

/** Null unless `items` is an array of entries with strictly increasing steps, each accepted by `parse`. */
function parseSteps<T extends { readonly step: number }>(
  items: unknown,
  parse: (v: Record<string, unknown>, step: number) => T | null,
): T[] | null {
  if (!Array.isArray(items)) return null;
  const parsed: T[] = [];
  for (const item of items as unknown[]) {
    if (!isRecord(item) || !isStep(item.step)) return null;
    const prev = parsed[parsed.length - 1];
    if (prev !== undefined && item.step <= prev.step) return null;
    const entry = parse(item, item.step);
    if (entry === null) return null;
    parsed.push(entry);
  }
  return parsed;
}

function parseSample(
  { x, y, heading, pitch }: Record<string, unknown>,
  step: number,
): EinweiserSample | null {
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  if (!isFiniteNumber(heading) || !isFiniteNumber(pitch)) return null;
  return { step, x, y, heading, pitch };
}

function parseTrack(v: unknown): EinweiserTrack | null {
  if (!isRecord(v)) return null;
  const samples = parseSteps(v.samples, parseSample);
  const signs = parseSteps(v.signs, ({ sign }, step) =>
    sign === null || isMember(SIGN_IDS, sign) ? { step, sign } : null,
  );
  // the replay reads his pose from the first sample on (`createTrackCursor`)
  return samples === null || samples.length === 0 || signs === null ? null : { samples, signs };
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
  if (!isRecord(data) || ![1, 2, 3, 4].includes(data.version as number)) return null;
  const { layoutId, exerciseId, truckId, trailerId, steps, changes } = data;
  // Versions 1 to 3 predate roles: every such run was driven.
  const role = data.version === 4 ? data.role : 'driver';
  if (!isMember(ROLES, role)) return null;
  const einweiser = role === 'einweiser' ? parseTrack(data.einweiser) : undefined;
  if (einweiser === null || (role === 'driver' && data.einweiser !== undefined)) return null;
  // Version 1 predates lighting: every such run was drawn by day.
  const lighting = data.version === 1 ? DEFAULT_LIGHTING : data.lighting;
  if (!isMember(LIGHTING_MODES, lighting)) return null;
  // Versions 1 and 2 predate mirror-only runs: every such run had the top-down view.
  const mirrorsOnly = data.version === 1 || data.version === 2 ? false : data.mirrorsOnly;
  if (typeof mirrorsOnly !== 'boolean') return null;
  if (!isMember(LAYOUT_IDS, layoutId) || !isMember(TRUCK_IDS, truckId)) return null;
  if (!isMember(TRAILER_IDS, trailerId) || !isStep(steps)) return null;
  if (exerciseId !== null && !isMember(EXERCISE_IDS, exerciseId)) return null;
  if (data.fingerprint !== fingerprint({ layoutId, exerciseId, truckId, trailerId, role }))
    return null;
  const parsed = parseSteps(changes, (change, step): InputChange | null => {
    const control = parseControl(change.control);
    return control === null ? null : { step, control };
  });
  if (parsed === null) return null;
  return {
    version: 4,
    role,
    ...(einweiser === undefined ? {} : { einweiser }),
    layoutId,
    exerciseId,
    truckId,
    trailerId,
    lighting,
    mirrorsOnly,
    steps,
    changes: parsed,
  };
}
