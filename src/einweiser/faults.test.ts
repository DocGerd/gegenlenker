import { describe, expect, it } from 'vitest';
import type { SimSnapshot } from '../contracts/sim';
import { BRAKE_DECEL, V_MAX } from '../sim/constants';
import { createSimulation } from '../sim/simulation';
import { trailers, trucks } from '../vehicles/registry';
import { clearance, lateHalt, runOver, signOutOfSight } from './faults';
import { sightGeometry } from './sight';
import { IN_PATH_MARGIN, inPath, REACTION_TIME, stoppingDistance } from './signs';
import { WALKER_RADIUS } from './walk';

const truck = trucks[0];
const trailer = trailers[0];
if (!truck || !trailer) throw new Error('no vehicles');
const g = sightGeometry(truck, trailer);

/** Reversing straight at `lever` from the origin, heading +x. */
function reversing(lever: number): SimSnapshot {
  const sim = createSimulation(g.params, { truck: { x: 0, y: 0, heading: 0 } }, () => null);
  let s = sim.snapshot();
  for (let k = 0; k < 180; k++) s = sim.step({ steer: 0, lever, brake: false, gear: 'R' });
  return s;
}

describe('fault predicates', () => {
  it('puts him in the path within the braking distance plus the margin, not beyond', () => {
    const s = reversing(0.5);
    const reach = stoppingDistance(0.5 * V_MAX, BRAKE_DECEL) + IN_PATH_MARGIN + WALKER_RADIUS;
    const behind = (d: number) => ({ x: s.trailerRear.x - d, y: s.trailerRear.y });
    expect(inPath(g, s, behind(reach - 0.3))).toBe(true);
    expect(inPath(g, s, behind(reach + 0.3))).toBe(false);
    // the braking distance grows with speed
    expect(inPath(g, reversing(1), behind(reach + 0.3))).toBe(true);
  });

  it('grows the run-over circle by his displacement since the last held sample', () => {
    const s = reversing(0.5);
    const beside = { x: s.trailerRear.x + 1, y: g.params.trailerWidth / 2 + WALKER_RADIUS + 0.2 };
    expect(clearance(g.params, s, beside)).toBeCloseTo(0.2, 9);
    expect(runOver(g.params, s, beside, 0)).toBe(false);
    expect(runOver(g.params, s, beside, 0.3)).toBe(true);
  });

  it('scores a sign started out of sight, and a contact under a movement sign warned of for longer than the reaction time', () => {
    expect(signOutOfSight(null, 'herkommen', false)).toBe(true);
    expect(signOutOfSight('herkommen', 'herkommen', false)).toBe(false);
    expect(signOutOfSight(null, 'herkommen', true)).toBe(false);
    expect(lateHalt(true, 'herkommen', REACTION_TIME + 0.1)).toBe(true);
    expect(lateHalt(true, 'herkommen', REACTION_TIME - 0.1)).toBe(false);
    expect(lateHalt(true, 'halt', REACTION_TIME + 0.1)).toBe(false);
  });
});
