import { describe, expect, it } from 'vitest';
import type { SignId } from '../contracts/einweiser';
import type { RunResult } from '../contracts/exercise';
import type { ControlVector } from '../contracts/sim';
import type { TrailerId } from '../contracts/vehicle';
import { EINWEISER_REVISION } from '../einweiser/fingerprint';
import { layoutOccluders, sightGeometry } from '../einweiser/sight';
import { createReader, perceive } from '../einweiser/signs';
import { createTrackCursor } from '../einweiser/track';
import { startWalker } from '../einweiser/walk';
import { createEinweiserReplay } from '../scoring/einweiser';
import { createRunTracker, runResult } from '../scoring/score';
import { SIM_REVISION } from '../sim/fingerprint';
import { createReplayCursor, parseInputLog, replaySnapshots, type RunIds } from '../sim/replay';
import { createSimulation } from '../sim/simulation';
import { guidedRun, resolveRun } from './run';

const ctl = (c: Partial<ControlVector>): ControlVector => ({
  steer: 0,
  lever: 0,
  brake: false,
  gear: 'D',
  ...c,
});

// Stored as version 3 wrote it, so the pin also proves older logs still load and replay unchanged.
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
} as const;

// Couples, tows the trailer into the target, uncouples there and drives away.
const COUPLING_LOG = {
  version: 4,
  role: 'driver',
  lighting: 'day',
  mirrorsOnly: false,
  steps: 4300,
  changes: [
    { step: 0, control: ctl({ lever: 0.2, gear: 'R' }) },
    { step: 1600, control: ctl({ lever: 0.5 }) },
    { step: 3300, control: ctl({ brake: true }) },
    { step: 3400, control: { ...ctl({ brake: true }), uncouple: true } },
    { step: 3401, control: ctl({ lever: 0.4 }) },
    { step: 4020, control: ctl({ brake: true }) },
  ],
} as const;

const fnv = (text: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

function pinned(
  layoutId: 'depot' | 'logistics',
  exerciseId: 'slalom' | 'reverse-bay' | 'coupling',
  trailerId: TrailerId | null = 'krone-azw-18',
  fixed: object = FIXED_LOG,
) {
  const ids = { layoutId, exerciseId, truckId: 'man-le-18-280', trailerId } as const;
  const fingerprint = (i: RunIds): string => resolveRun(i).fingerprint;
  // only version 4 holds a solo run
  const solo = trailerId === null ? { version: 4, role: 'driver' } : {};
  const stored = {
    ...fixed,
    ...solo,
    ...ids,
    fingerprint: fingerprint({ ...ids, role: 'driver' }),
  };
  const log = parseInputLog(JSON.stringify(stored), fingerprint);
  if (log === null) throw new Error('stored log expected to load');
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

  it('logistics solo', () => {
    expect(pinned('logistics', 'reverse-bay', null)).toEqual({
      SIM_REVISION: 2,
      digest: 'ffb5087d',
    });
  });

  // reached: it couples, leaves the trailer in the target and drives away
  it('depot coupling', () => {
    expect(pinned('depot', 'coupling', 'krone-azw-18', COUPLING_LOG)).toEqual({
      SIM_REVISION: 2,
      digest: '32e6fe84',
    });
  });
});

it('refuses an Einweiser run solo', () => {
  const ids = { layoutId: 'depot', exerciseId: null, truckId: 'man-le-18-280' } as const;
  expect(resolveRun({ ...ids, trailerId: 'krone-azw-18', role: 'einweiser' })).toBeDefined();
  expect(() => resolveRun({ ...ids, trailerId: null, role: 'einweiser' })).toThrow();
});

// His track as offsets (m, rad) from his start pose, and the signs he shows, over FIXED_LOG's controls.
const FIXED_TRACK = {
  samples: [
    { step: 0, dx: 0, dy: 0, dh: 0, pitch: 0 },
    { step: 600, dx: -2, dy: 1.5, dh: -0.3, pitch: 0.05 },
    { step: 1500, dx: 4, dy: -6, dh: 0.8, pitch: -0.1 },
    { step: 2100, dx: 9, dy: -3, dh: 0.2, pitch: 0 },
  ],
  signs: [
    { step: 60, sign: 'achtung' },
    { step: 180, sign: 'herkommen' },
    { step: 900, sign: 'halt' },
    { step: 1260, sign: 'rechts' },
    { step: 1800, sign: null },
    { step: 1950, sign: 'haltGefahr' },
  ],
} as const satisfies {
  samples: readonly object[];
  signs: readonly { step: number; sign: SignId | null }[];
};

/** What the driver reads of him along a fixed Einweiser log: sight and readings, as a replay derives them. */
function pinnedEinweiser(layoutId: 'depot' | 'logistics', exerciseId: 'slalom' | 'reverse-bay') {
  const ids = {
    layoutId,
    exerciseId,
    truckId: 'man-le-18-280',
    trailerId: 'krone-azw-18',
  } as const;
  const driver = guidedRun({ ...ids, role: 'driver' });
  const first = createSimulation(driver.params, driver.start, driver.contacts).snapshot();
  const base = startWalker(driver.params, first);
  const round = (v: number, scale: number): number => Math.round(v * scale) / scale;
  const einweiser = {
    samples: FIXED_TRACK.samples.map(({ step, dx, dy, dh, pitch }) => ({
      step,
      x: round(base.x + dx, 100),
      y: round(base.y + dy, 100),
      heading: round(base.heading + dh, 1000),
      pitch,
    })),
    signs: FIXED_TRACK.signs,
  };
  const fingerprint = (i: RunIds): string => resolveRun(i).fingerprint;
  const stored = { ...FIXED_LOG, version: 4, role: 'einweiser', einweiser, ...ids };
  const log = parseInputLog(
    JSON.stringify({ ...stored, fingerprint: fingerprint({ ...ids, role: 'einweiser' }) }),
    fingerprint,
  );
  if (log?.einweiser === undefined) throw new Error('stored Einweiser log expected to load');
  const run = guidedRun(log);
  expect(run.fingerprint).not.toBe(driver.fingerprint);

  const g = sightGeometry(run.truck, run.trailer);
  const occluders = layoutOccluders(run.layout);
  const sim = createSimulation(run.params, run.start, run.contacts);
  const snapshots = [sim.snapshot(), ...replaySnapshots(log, sim)];
  const before = snapshots.slice(0, log.steps);
  const cursor = createTrackCursor(log.einweiser);
  const reader = createReader();
  const events: unknown[] = [];
  let sight = '';
  for (const s of before) {
    const { held, sign } = cursor.at(s.step);
    const p = perceive(g, s, held, sign, occluders);
    const reading = reader.read(sign, p, s.speed === 0);
    const seen = JSON.stringify(p.sight);
    if (seen !== sight) events.push([s.step, p.sight]);
    if (reading.kind !== 'none') events.push([s.step, reading]);
    sight = seen;
  }
  // the faults as the replay derives them (`src/scoring/einweiser.ts`)
  const [start, ...after] = snapshots;
  if (start === undefined) throw new Error('a replay starts with a snapshot');
  const replay = createEinweiserReplay(
    { g, occluders, contacts: run.contacts },
    log.einweiser,
    start,
  );
  for (const s of after) replay.update(s);
  return {
    EINWEISER_REVISION,
    digest: fnv(JSON.stringify(events)),
    result: replay.tracker.result(),
  };
}

describe('Einweiser run pin', () => {
  // A change here without an EINWEISER_REVISION bump keeps stored Einweiser runs that would replay with other faults.
  it('depot', () => {
    expect(pinnedEinweiser('depot', 'slalom')).toEqual({
      EINWEISER_REVISION: 1,
      digest: '4d55ab0a',
      result: {
        runOver: false,
        faults: {
          inPath: 0,
          tooClose: 0,
          outOfSight: 0,
          signOutOfSight: 1,
          unclear: 2,
          lateHalt: 0,
          noAchtung: 0,
        },
        walkedBackwards: true,
      },
    });
  });

  it('logistics', () => {
    expect(pinnedEinweiser('logistics', 'reverse-bay')).toEqual({
      EINWEISER_REVISION: 1,
      digest: 'a29c260e',
      result: {
        runOver: false,
        faults: {
          inPath: 0,
          tooClose: 0,
          outOfSight: 0,
          signOutOfSight: 0,
          unclear: 3,
          lateHalt: 0,
          noAchtung: 0,
        },
        walkedBackwards: true,
      },
    });
  });
});
