import { describe, expect, it } from 'vitest';
import type { TargetZone } from '../contracts/exercise';
import type { ControlVector, SimSnapshot } from '../contracts/sim';
import { trailers, trucks } from '../vehicles/registry';
import { createRunTracker } from '../scoring/score';
import { wrapAngle } from '../sim/angle';
import { createSimulation } from '../sim/simulation';
import { straightReverse } from './exercises/straight-reverse';
import { resolveRun } from './run';

const clamp = (x: number, limit: number): number => Math.max(-limit, Math.min(limit, x));
const STOPPING_DISTANCE = 0.2; // at the lever below, from brake to standstill
const MAX_STEPS = 20_000;

/** A cascade of proportional loops, one per joint, from the trailer's lateral error back to the steering. */
function corrected(s: SimSnapshot, target: TargetZone): ControlVector {
  const { x: stopX, y: lineY } = target.pose;
  const trailerHeading = clamp(0.15 * (s.trailerRear.y - lineY), 0.1);
  const turntable = clamp(2 * wrapAngle(s.trailer.heading - trailerHeading), 0.3);
  const coupling = clamp(-2 * wrapAngle(s.trailer.heading + turntable - s.dolly.heading), 0.5);
  const steer = clamp(-4 * wrapAngle(s.dolly.heading + coupling - s.truck.heading), 1);
  return { steer, lever: 0.6, brake: s.trailerRear.x < stopX + STOPPING_DISTANCE, gear: 'R' };
}

function reverse(
  truckId: (typeof trucks)[number]['id'],
  trailerId: (typeof trailers)[number]['id'],
  control: (s: SimSnapshot, target: TargetZone) => ControlVector,
  turntable?: number,
): { final: SimSnapshot; reached: boolean } {
  const run = resolveRun({ layoutId: 'depot', exerciseId: 'straight-reverse', truckId, trailerId });
  const { exercise } = run;
  if (exercise === null) throw new Error('exercise expected');
  const start = turntable === undefined ? run.start : { ...run.start, turntableAngle: turntable };
  const sim = createSimulation(run.params, start, run.contacts);
  const tracker = createRunTracker(exercise);
  let final = sim.snapshot();
  for (let i = 0; i < MAX_STEPS; i++) {
    final = sim.step(control(final, exercise.target));
    if (tracker.update(final)) return { final, reached: true };
    if (final.blocked !== null) break;
  }
  return { final, reached: false };
}

describe('straight reverse starts bent', () => {
  const combinations = trucks.flatMap((truck) =>
    trailers.map((trailer) => ({ truck: truck.id, trailer: trailer.id })),
  );

  it('resolves the bend into the start state, and only for this exercise', () => {
    const run = resolveRun({
      layoutId: 'depot',
      exerciseId: 'straight-reverse',
      truckId: 'man-le-18-280',
      trailerId: 'krone-azw-18',
    });
    expect(run.start.couplingAngle).toBe(0);
    expect(run.start.turntableAngle).toBeGreaterThan(0);
    const other = resolveRun({
      layoutId: 'logistics',
      exerciseId: 'reverse-bay',
      truckId: 'man-le-18-280',
      trailerId: 'krone-azw-18',
    });
    expect(Object.keys(other.start)).toEqual(['truck']);
  });

  // The drift grows exponentially, so any bend fails; half of it still failing is the margin the angle keeps.
  it('is not solved by leaving the wheel straight, even at half the bend: every pair meets a cone or jackknifes', () => {
    const bend = straightReverse.startArticulation?.turntable ?? 0;
    expect(bend).toBeGreaterThan(0);
    for (const turntable of [bend, bend / 2]) {
      for (const { truck, trailer } of combinations) {
        const { final, reached } = reverse(
          truck,
          trailer,
          () => ({ steer: 0, lever: 1, brake: false, gear: 'R' }),
          turntable,
        );
        expect(reached, `${truck} ${trailer}`).toBe(false);
        expect(final.contacts + final.jackknifes, `${truck} ${trailer}`).toBeGreaterThan(0);
      }
    }
  });

  it('is solved by correcting the drift: every pair reaches the target without contact', () => {
    for (const { truck, trailer } of combinations) {
      const { final, reached } = reverse(truck, trailer, corrected);
      expect(reached, `${truck} ${trailer}`).toBe(true);
      expect(final.contacts, `${truck} ${trailer}`).toBe(0);
      expect(final.jackknifes, `${truck} ${trailer}`).toBe(0);
    }
  });
});
