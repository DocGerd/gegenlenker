import { describe, expect, it } from 'vitest';
import type { ExerciseDefinition, RunResult } from '../contracts/exercise';
import type { SimSnapshot } from '../contracts/sim';
import {
  bestKey,
  compareResults,
  exerciseDone,
  parseBestResults,
  recordBest,
  serializeBestResults,
} from './best';
import { criteria, deltasToBest, endedMoving } from './debrief';
import { createEventScanner } from './replay-events';
import { WAYPOINT_RADIUS, createRunTracker, runResult, targetError } from './score';

function snap(over: Partial<SimSnapshot> = {}): SimSnapshot {
  return {
    step: 0,
    time: 12,
    truck: { x: 0, y: 0, heading: 0 },
    coupling: { x: 0, y: 0 },
    dolly: { x: 0, y: 0, heading: 0 },
    trailer: { x: 0, y: 0, heading: 0 },
    trailerRear: { x: 0, y: 0 },
    couplingAngle: 0,
    turntableAngle: 0,
    steer: 0,
    roadWheelAngle: 0,
    speed: 0,
    control: { steer: 0, lever: 0, brake: false, gear: 'P' },
    blocked: null,
    contacts: 0,
    jackknifes: 0,
    directionChanges: 0,
    ...over,
  };
}

function exercise(waypoint: ExerciseDefinition['waypoint'] = null): ExerciseDefinition {
  return {
    id: 'reverse-bay',
    layout: 'depot',
    start: { x: 0, y: 0, heading: 0 },
    target: { pose: { x: 0, y: 0, heading: -0.1 }, length: 15, width: 3.5 },
    tolerances: { position: 0.5, angle: 10 },
    waypoint,
    obstacles: [],
    markings: [],
  };
}

function result(over: Partial<RunResult> = {}): RunResult {
  return {
    exerciseId: 'reverse-bay',
    truckId: 'man-le-18-280',
    trailerId: 'krone-azw-18',
    reached: true,
    assisted: false,
    waypointMissed: false,
    positionError: 0.1,
    angleError: 1,
    contacts: 0,
    jackknifes: 0,
    directionChanges: 0,
    time: 30,
    ...over,
  };
}

describe('exerciseDone', () => {
  it('counts a reached result with any pair, ignoring other exercises and misses', () => {
    const other = result({ trailerId: 'hueffermann-hpa-24-81-l' });
    const best = {
      [bestKey('reverse-bay', 'man-le-18-280', 'krone-azw-18', false)]: result({ reached: false }),
      [bestKey('reverse-bay', 'man-le-18-280', 'hueffermann-hpa-24-81-l', false)]: other,
      [bestKey('slalom', 'man-le-18-280', 'krone-azw-18', false)]: result({
        exerciseId: 'slalom',
        reached: false,
      }),
    };
    expect(exerciseDone(best, 'reverse-bay')).toBe(true);
    expect(exerciseDone(best, 'slalom')).toBe(false);
    expect(exerciseDone({}, 'reverse-bay')).toBe(false);
  });
});

const KEY = bestKey('reverse-bay', 'man-le-18-280', 'krone-azw-18', false);
const INSIDE = { trailer: { x: 0, y: 0, heading: -0.1 } };

describe('scoring', () => {
  it('measures position at the trailer rear and angle at the trailer heading', () => {
    const zone = { pose: { x: 0, y: 0, heading: -0.1 }, length: 15, width: 3.5 };
    const e = targetError(
      snap({ trailerRear: { x: 3, y: 4 }, trailer: { x: 0, y: 0, heading: 0.1 } }),
      zone,
    );
    expect(e.position).toBeCloseTo(5, 9);
    expect(e.angle).toBeCloseTo(11.459, 3);

    const wrapped = targetError(snap({ trailer: { x: 0, y: 0, heading: Math.PI - 0.1 } }), {
      ...zone,
      pose: { x: 0, y: 0, heading: -Math.PI + 0.1 },
    });
    expect(wrapped.angle).toBeCloseTo(11.459, 3);
  });

  it('reaches the target only when stopped within tolerance', () => {
    const tracker = createRunTracker(exercise());
    expect(tracker.update(snap({ ...INSIDE, speed: 0.2 }))).toBe(false);
    expect(tracker.update(snap({ ...INSIDE, speed: 0 }))).toBe(true);
    expect(tracker.update(snap({ ...INSIDE, trailerRear: { x: 0.51, y: 0 } }))).toBe(false);
  });

  it('cues only near the target once the turn point is passed', () => {
    const tracker = createRunTracker(exercise({ x: 90, y: 25 }));
    expect(tracker.goal(snap(INSIDE))).toBe('away');
    tracker.update(snap({ truck: { x: 90, y: 25, heading: 0 } }));
    expect(tracker.goal(snap(INSIDE))).toBe('inside');
    expect(tracker.goal(snap({ ...INSIDE, trailerRear: { x: 0.51, y: 0 } }))).toBe('outside');
    expect(tracker.goal(snap({ ...INSIDE, trailerRear: { x: 16, y: 0 } }))).toBe('away');
  });

  it('requires the waypoint before the target counts', () => {
    const tracker = createRunTracker(exercise({ x: 90, y: 25 }));
    expect(tracker.update(snap(INSIDE))).toBe(false);
    tracker.update(snap({ truck: { x: 90 + WAYPOINT_RADIUS + 0.1, y: 25, heading: 0 } }));
    expect(tracker.update(snap(INSIDE))).toBe(false);
    tracker.update(snap({ truck: { x: 90 + WAYPOINT_RADIUS, y: 25, heading: 0 } }));
    expect(tracker.update(snap(INSIDE))).toBe(true);
  });

  it('fills a result from the final snapshot', () => {
    const s = snap({
      contacts: 2,
      jackknifes: 1,
      directionChanges: 4,
      time: 42.5,
      trailerRear: { x: 3, y: 4 },
      trailer: { x: 0, y: 0, heading: 0.1 },
    });
    const r = runResult(
      s,
      exercise(),
      'arocs-1835-ak',
      'hueffermann-hpa-24-81-l',
      false,
      true,
      false,
    );
    expect(r).toMatchObject({
      exerciseId: 'reverse-bay',
      truckId: 'arocs-1835-ak',
      trailerId: 'hueffermann-hpa-24-81-l',
      reached: false,
      contacts: 2,
      jackknifes: 1,
      directionChanges: 4,
      time: 42.5,
    });
    expect(r.positionError).toBeCloseTo(5, 9);
    expect(r.angleError).toBeCloseTo(11.459, 3);

    expect(
      runResult(snap(INSIDE), exercise(), 'arocs-1835-ak', 'krone-azw-18', true, true, false)
        .reached,
    ).toBe(true);
  });

  it('names the missed waypoint in the result', () => {
    const slalom = exercise({ x: 90, y: 25 });
    const s = snap(INSIDE);
    const tracker = createRunTracker(slalom);
    const reached = tracker.update(s);
    const result = runResult(
      s,
      slalom,
      'man-le-18-280',
      'krone-azw-18',
      reached,
      tracker.waypointVisited(),
      false,
    );
    expect(result.reached).toBe(false);
    expect(result.waypointMissed).toBe(true);
  });

  it('does not flag a waypoint missed when the exercise has none or it was visited', () => {
    const s = snap(INSIDE);
    expect(
      runResult(s, exercise(), 'man-le-18-280', 'krone-azw-18', false, false, false).waypointMissed,
    ).toBe(false);
    expect(
      runResult(s, exercise({ x: 90, y: 25 }), 'man-le-18-280', 'krone-azw-18', false, true, false)
        .waypointMissed,
    ).toBe(false);
  });

  it('rejects an angle outside tolerance even with the position inside', () => {
    const s = snap({ trailer: { x: 0, y: 0, heading: -0.1 + 0.2 } }); // 11.459° > 10°
    expect(targetError(s, exercise().target).position).toBe(0);
    expect(createRunTracker(exercise()).update(s)).toBe(false);
  });

  it('counts a slow reverse roll inside the stop threshold as stopped', () => {
    const tracker = createRunTracker(exercise());
    expect(tracker.update(snap({ ...INSIDE, speed: -0.01 }))).toBe(true);
    expect(tracker.update(snap({ ...INSIDE, speed: -0.2 }))).toBe(false);
  });
});

describe('best results', () => {
  it('orders results: reached, then fewer events, then fewer direction changes, then less time', () => {
    const base = result();
    expect(compareResults(base, result({ reached: false }))).toBeLessThan(0);
    expect(compareResults(result({ reached: false }), result({ contacts: 5 }))).toBeGreaterThan(0);
    expect(compareResults(base, result({ contacts: 1 }))).toBeLessThan(0);
    expect(compareResults(base, result({ jackknifes: 1, directionChanges: 0 }))).toBeLessThan(0);
    expect(
      compareResults(result({ contacts: 2 }), result({ jackknifes: 1, directionChanges: 9 })),
    ).toBeGreaterThan(0);
    expect(
      compareResults(result({ contacts: 1 }), result({ jackknifes: 1, directionChanges: 9 })),
    ).toBeLessThan(0);
    expect(compareResults(base, result({ directionChanges: 1, time: 1 }))).toBeLessThan(0);
    expect(compareResults(base, result({ time: 31 }))).toBeLessThan(0);
    expect(compareResults(result({ time: 31 }), base)).toBeGreaterThan(0);
    expect(compareResults(base, result())).toBe(0);
  });

  it('orders unreached results by closeness to the target before events and time', () => {
    const quit = result({ reached: false, positionError: 40, angleError: 90, time: 0 });
    const tried = result({
      reached: false,
      positionError: 2,
      angleError: 90,
      contacts: 3,
      time: 90,
    });
    expect(compareResults(tried, quit)).toBeLessThan(0);
    expect(recordBest({ [KEY]: quit }, tried).isNewBest).toBe(false);
    const straighter = result({ reached: false, positionError: 2, angleError: 5, contacts: 3 });
    expect(compareResults(straighter, tried)).toBeLessThan(0);
    expect(compareResults(tried, result({ ...tried, contacts: 0 }))).toBeGreaterThan(0);
  });

  it('never records a miss as a best', () => {
    const miss = result({ reached: false });
    expect(recordBest({}, miss)).toEqual({ best: {}, isNewBest: false, previous: null });
    const hit = recordBest({}, result()).best;
    const after = recordBest(hit, miss);
    expect(after.best).toBe(hit);
    expect(after.isNewBest).toBe(false);
    expect(after.previous).toEqual(result());
    expect(recordBest({ [KEY]: miss }, result({ time: 99 })).isNewBest).toBe(true);
  });

  it('keeps only better results', () => {
    const first = recordBest({}, result({ time: 30 }));
    expect(first.isNewBest).toBe(true);
    expect(first.best[KEY]).toEqual(result({ time: 30 }));

    const worse = recordBest(first.best, result({ time: 40 }));
    expect(worse.isNewBest).toBe(false);
    expect(worse.best).toBe(first.best);

    const better = recordBest(first.best, result({ time: 20 }));
    expect(better.isNewBest).toBe(true);
    expect(better.best[KEY]?.time).toBe(20);
  });

  it('reads stored results defensively', () => {
    const fingerprint = (): string => 'data-a';
    const parse = (raw: string | null) => parseBestResults(raw, fingerprint);
    expect(parse(null)).toEqual({});
    expect(parse('{')).toEqual({});
    expect(parse(JSON.stringify({ version: 1, results: {} }))).toEqual({});

    const valid = result();
    expect(parse(serializeBestResults({ [KEY]: valid }, fingerprint))).toEqual({ [KEY]: valid });

    const stored = { ...valid, fingerprint: 'data-a' };
    const noTime: Record<string, unknown> = {
      ...result({ trailerId: 'hueffermann-hpa-24-81-l' }),
      fingerprint: 'data-a',
    };
    delete noTime.time;
    const otherKey = bestKey('reverse-bay', 'man-le-18-280', 'hueffermann-hpa-24-81-l', false);
    const raw = JSON.stringify({
      version: 2,
      results: { [KEY]: stored, [otherKey]: noTime, 'slalom/man-le-18-280/krone-azw-18': stored },
    });
    expect(parse(raw)).toEqual({ [KEY]: valid });
  });

  it('ranks assisted and unaided runs apart', () => {
    const unaided = recordBest({}, result({ time: 30 })).best;
    const assisted = recordBest(unaided, result({ assisted: true, time: 10 }));
    expect(assisted.isNewBest).toBe(true);
    expect(assisted.previous).toBeNull();
    expect(assisted.best[KEY]).toEqual(result({ time: 30 }));
    expect(assisted.best[bestKey('reverse-bay', 'man-le-18-280', 'krone-azw-18', true)]?.time).toBe(
      10,
    );
    expect(recordBest(assisted.best, result({ time: 40 })).previous?.time).toBe(30);
  });

  it('wipes bests stored before aids were recorded', () => {
    const legacy = JSON.stringify({
      version: 1,
      results: { 'reverse-bay/man-le-18-280/krone-azw-18': { ...result(), fingerprint: 'f' } },
    });
    expect(parseBestResults(legacy, () => 'f')).toEqual({});
  });

  it('keeps a stored result only for the data that produced it', () => {
    const other = result({ trailerId: 'hueffermann-hpa-24-81-l' });
    const otherKey = bestKey(other.exerciseId, other.truckId, other.trailerId, false);
    const fingerprint = (r: Pick<RunResult, 'exerciseId' | 'truckId' | 'trailerId'>): string =>
      r.trailerId === 'krone-azw-18' ? 'data-a' : 'data-b';
    const raw = (results: Record<string, unknown>): string =>
      JSON.stringify({ version: 2, results });
    expect(
      parseBestResults(
        raw({
          [KEY]: { ...result(), fingerprint: 'data-a' },
          [otherKey]: { ...other, fingerprint: 'data-a' },
        }),
        fingerprint,
      ),
    ).toEqual({ [KEY]: result() });
    expect(parseBestResults(raw({ [KEY]: result() }), fingerprint)).toEqual({});
  });
});

describe('debrief', () => {
  const tolerances = { position: 0.5, angle: 10 };

  it('judges position and angle against their tolerance, inclusive', () => {
    const [position, angle] = criteria(
      result({ positionError: 0.5, angleError: 10.1 }),
      tolerances,
    );
    expect(position?.passed).toBe(true);
    expect(angle?.passed).toBe(false);
  });

  it('tells a run that ended while moving from one that missed the target', () => {
    expect(endedMoving(result({ reached: false }), tolerances)).toBe(true);
    expect(endedMoving(result({ reached: false, positionError: 2 }), tolerances)).toBe(false);
    expect(endedMoving(result({ reached: false, waypointMissed: true }), tolerances)).toBe(false);
    expect(endedMoving(result(), tolerances)).toBe(false);
  });

  it('reports a faster run as a negative time delta', () => {
    const d = deltasToBest(result({ time: 25, contacts: 1 }), result({ time: 30 }));
    expect(d?.time).toBe(-5);
    expect(d?.contacts).toBe(1);
  });

  it('compares only like with like', () => {
    expect(deltasToBest(result({ reached: false }), result())).toBeNull();
    expect(deltasToBest(result(), result({ reached: false }))).toBeNull();
  });
});

describe('replay events', () => {
  it('marks contacts, stops, the waypoint and the finish once each', () => {
    const scanner = createEventScanner(exercise({ x: 90, y: 25 }));
    const frames: Partial<SimSnapshot>[] = [
      { step: 1, speed: 1 },
      { step: 2, speed: 1, contacts: 1 },
      { step: 3, speed: 0, contacts: 1 },
      { step: 4, speed: 1, contacts: 1, truck: { x: 90, y: 25, heading: 0 } },
      { step: 5, speed: 0, contacts: 1, ...INSIDE },
      { step: 6, speed: 0, contacts: 1, ...INSIDE },
    ];
    for (const f of frames) scanner.update(snap(f));
    expect(scanner.events()).toEqual([
      { kind: 'contact', step: 2 },
      { kind: 'stop', step: 3 },
      { kind: 'waypoint', step: 4 },
      { kind: 'reached', step: 5 },
    ]);
  });
});
