import { describe, expect, it } from 'vitest';
import { resolveRun } from '../content/run';
import type { EinweiserResult, SignId } from '../contracts/einweiser';
import type { SimSnapshot } from '../contracts/sim';
import { layoutOccluders, sightGeometry } from '../einweiser/sight';
import type { Reading } from '../einweiser/signs';
import { createEinweiserRun } from '../einweiser/track';
import { STILL, type Walker, type WalkKeys } from '../einweiser/walk';
import { createInputRecorder, replaySnapshots, type RunIds } from '../sim/replay';
import { createSimulation } from '../sim/simulation';
import { trailerById, truckById } from '../vehicles/registry';
import { createEinweiserReplay, createEinweiserTracker } from './einweiser';
import { createEventScanner } from './replay-events';

const yard: RunIds = {
  layoutId: 'depot',
  exerciseId: null,
  truckId: 'man-le-18-280',
  trailerId: 'krone-azw-18',
  role: 'einweiser',
};
const slalom: RunIds = { ...yard, exerciseId: 'slalom' };

type Script = (step: number, s: SimSnapshot, w: Walker) => { keys: WalkKeys; sign: SignId | null };

const scene = (ids: RunIds) => {
  const run = resolveRun(ids);
  const g = sightGeometry(truckById(ids.truckId), trailerById(ids.trailerId));
  return { run, g, occluders: layoutOccluders(run.layout), contacts: run.contacts };
};

/** As `drive.ts` steps an Einweiser run: until the run-over ends it, or `steps`. */
function drive(ids: RunIds, script: Script, steps: number) {
  const { run, g, occluders } = scene(ids);
  const sim = createSimulation(run.params, run.start, run.contacts);
  let s = sim.snapshot();
  const einweiser = createEinweiserRun({ g, occluders, yard: run.layout.yard, start: s });
  const tracker = createEinweiserTracker(g, run.contacts);
  const recorder = createInputRecorder();
  const heading = einweiser.walker().heading;
  while (s.step < steps && !tracker.runOver()) {
    const { keys, sign } = script(s.step, s, einweiser.walker());
    const d = einweiser.step(s, { keys, heading, pitch: 0, sign });
    recorder.record(s.step, d.control);
    const before = s;
    s = sim.step(d.control);
    tracker.update({
      before,
      after: s,
      held: d.status.held,
      moved: d.moved,
      sign,
      inSight: d.perception.inSight,
      reading: d.reading,
    });
  }
  const meta = {
    ...ids,
    lighting: 'day',
    mirrorsOnly: false,
    einweiser: einweiser.track(),
  } as const;
  return { log: recorder.finish(meta, s.step), result: tracker.result() };
}

/** How far behind the trailer rear he stands, along its heading. */
const behind = (s: SimSnapshot, w: Walker): number =>
  -(
    (w.x - s.trailerRear.x) * Math.cos(s.trailer.heading) +
    (w.y - s.trailerRear.y) * Math.sin(s.trailer.heading)
  );

const CASES: readonly {
  name: string;
  ids: RunIds;
  script: Script;
  expected: (r: EinweiserResult) => void;
}[] = [
  {
    // Herkommen without Achtung, a walk backwards, then a jog into the reversing trailer's track.
    name: 'run over',
    ids: yard,
    script: (step, s, w) => ({
      keys:
        step >= 200 && step < 260
          ? { ...STILL, back: true }
          : s.speed !== 0 && behind(s, w) < 0.9
            ? { ...STILL, right: true, jog: true }
            : STILL,
      sign: step >= 30 ? 'herkommen' : null,
    }),
    expected: (r) => {
      expect(r.runOver).toBe(true);
      expect(r.walkedBackwards).toBe(true);
      expect(r.faults).toMatchObject({ noAchtung: 1, inPath: 1, tooClose: 1, lateHalt: 0 });
    },
  },
  {
    // Achtung, then Herkommen while he backs away ahead of the trailer, into the slalom cones.
    name: 'late halt',
    ids: slalom,
    script: (step, s, w) => ({
      keys: behind(s, w) < 3 ? { ...STILL, back: true } : STILL,
      sign: step < 60 ? 'achtung' : 'herkommen',
    }),
    expected: (r) => {
      expect(r.runOver).toBe(false);
      expect(r.faults).toMatchObject({ noAchtung: 0, lateHalt: 1 });
    },
  },
];

describe('Einweiser scoring', () => {
  it.each(CASES)(
    'derives the live faults again from the log: $name',
    ({ ids, script, expected }) => {
      const { log, result } = drive(ids, script, 3000);
      expected(result);
      const { run, g, occluders, contacts } = scene(log);
      const sim = createSimulation(run.params, run.start, run.contacts);
      if (log.einweiser === undefined) throw new Error('an Einweiser log has a track');
      const replay = createEinweiserReplay(
        { g, occluders, contacts },
        log.einweiser,
        sim.snapshot(),
      );
      // through the replay's event scanner, which feeds it
      const scanner = createEventScanner(run.exercise, replay);
      for (const s of replaySnapshots(log, sim)) scanner.update(s);
      expect(replay.tracker.result()).toEqual(result);
    },
  );

  const standing = (() => {
    const { run } = scene(yard);
    return createSimulation(run.params, run.start, run.contacts).snapshot();
  })();
  const feed = (readings: readonly Reading[]) => {
    const { g, contacts } = scene(yard);
    const tracker = createEinweiserTracker(g, contacts);
    for (const reading of readings) {
      tracker.update({
        before: standing,
        after: standing,
        held: { x: standing.truck.x + 20, y: standing.truck.y, heading: 0 },
        moved: 0,
        sign: null,
        inSight: true,
        reading,
      });
    }
    return tracker;
  };
  const recognised = (sign: SignId | null): Reading => ({
    kind: 'recognised',
    sign,
    station: 'ahead',
  });

  it('ends a run only after a recognised Halt, kept until the next reading', () => {
    expect(feed([recognised('halt'), { kind: 'none' }]).halted()).toBe(true);
    expect(feed([recognised('haltGefahr')]).halted()).toBe(false);
    expect(feed([recognised('halt'), recognised(null)]).halted()).toBe(false);
    expect(feed([recognised('halt'), { kind: 'unclear', sign: 'halt' }]).halted()).toBe(false);
    expect(feed([recognised('halt'), { kind: 'lost' }]).halted()).toBe(false);
  });

  it('counts a run started without Achtung once', () => {
    const before = feed([recognised('herkommen'), recognised('entfernen')]).result();
    expect(before.faults.noAchtung).toBe(1);
    const after = feed([recognised('achtung'), recognised('herkommen')]).result();
    expect(after.faults.noAchtung).toBe(0);
  });
});
