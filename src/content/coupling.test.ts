import { describe, expect, it } from 'vitest';
import type { ControlVector, SimSnapshot } from '../contracts/sim';
import { TRAILER_IDS, TRUCK_IDS } from '../contracts/vehicle';
import { COUPLING_SPEED, createRunTracker, DRIVE_AWAY, runResult } from '../scoring/score';
import { BRAKE_DECEL } from '../sim/constants';
import { createSimulation } from '../sim/simulation';
import { resolveRun } from './run';

const CAP = 20_000;
const ctl = (c: Partial<ControlVector>): ControlVector => ({
  steer: 0,
  lever: 0,
  brake: false,
  gear: 'D',
  ...c,
});
const runs = TRUCK_IDS.flatMap((truckId) =>
  TRAILER_IDS.map(
    (trailerId) =>
      ({ layoutId: 'depot', exerciseId: 'coupling', truckId, trailerId, role: 'driver' }) as const,
  ),
);

type Phase = 'couple' | 'tow' | 'drop' | 'leave' | 'halt';

/** Couples, tows the trailer's rear to `dropAt` m along x, uncouples there and drives away; stops at the first reach. */
function drive(ids: (typeof runs)[number], dropAt: number) {
  const run = resolveRun(ids);
  const { exercise } = run;
  if (exercise === null) throw new Error('exercise expected');
  const sim = createSimulation(run.params, run.start, run.contacts);
  const tracker = createRunTracker(exercise);
  let s: SimSnapshot = sim.snapshot();
  let phase: Phase = 'couple';
  let reached = false;
  const stopsBy = (x: number): boolean => x + (s.speed * s.speed) / (2 * BRAKE_DECEL) >= dropAt;
  for (let i = 0; i < CAP && !reached; i++) {
    let control: ControlVector;
    if (phase === 'couple') {
      control = ctl({ gear: 'R', lever: 0.2 });
    } else if (phase === 'tow') {
      control = stopsBy(s.trailerRear.x) ? ctl({ brake: true }) : ctl({ lever: 0.5 });
    } else if (phase === 'drop') {
      control = ctl({ brake: true, uncouple: true });
    } else if (phase === 'leave') {
      control = ctl({ lever: 0.4 });
    } else control = ctl({ brake: true });
    s = sim.step(control);
    reached = tracker.update(s);
    const gap = s.hitch
      ? Math.hypot(s.coupling.x - s.hitch.eye.x, s.coupling.y - s.hitch.eye.y)
      : 0;
    if (phase === 'couple' && s.hitch?.coupled === true) phase = 'tow';
    else if (phase === 'tow' && s.speed === 0 && stopsBy(s.trailerRear.x)) phase = 'drop';
    else if (phase === 'drop' && s.hitch?.coupled === false) phase = 'leave';
    else if (phase === 'leave' && gap >= DRIVE_AWAY + 0.5) phase = 'halt';
  }
  const result = runResult(
    s,
    exercise,
    ids.truckId,
    ids.trailerId,
    reached,
    true,
    false,
    0,
    'day',
    false,
  );
  return { s, result, phase, goal: tracker.goal(s) };
}

describe.each(runs)('$truckId + $trailerId', (ids) => {
  it('couples, tows the trailer into the target, uncouples there and reaches it by driving away', () => {
    const target = resolveRun(ids).exercise?.target.pose.x ?? NaN;
    const { result, s } = drive(ids, target);
    expect(result).toMatchObject({ reached: true, contacts: 0, jackknifes: 0 });
    expect(result.positionError).toBeLessThan(0.1);
    expect(result.coupling?.speed).toBeGreaterThan(0);
    expect(result.coupling?.speed).toBeLessThanOrEqual(COUPLING_SPEED);
    // stopping beside the dropped trailer is not enough: the truck has to have driven away
    const eye = s.hitch?.eye ?? s.coupling;
    expect(s.hitch?.coupled).toBe(false);
    expect(Math.hypot(s.coupling.x - eye.x, s.coupling.y - eye.y)).toBeGreaterThanOrEqual(
      DRIVE_AWAY,
    );
  });

  it('does not reach it with the trailer left short of the target', () => {
    const target = resolveRun(ids).exercise?.target.pose.x ?? NaN;
    const { result, phase, goal } = drive(ids, target - 2);
    expect(phase).toBe('halt');
    expect(result.reached).toBe(false);
    expect(result.positionError).toBeGreaterThan(1.5);
    expect(goal).toBe('outside');
  });
});

it('is refused solo and as an Einweiser run', () => {
  const [ids] = runs;
  if (ids === undefined) throw new Error('no run');
  expect(() => resolveRun({ ...ids, trailerId: null })).toThrow();
  expect(() => resolveRun({ ...ids, role: 'einweiser' })).toThrow();
});
