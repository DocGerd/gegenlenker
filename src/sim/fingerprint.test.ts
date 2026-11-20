import { describe, expect, it } from 'vitest';
import { resolveRun } from '../content/run';
import type { Obstacle } from '../contracts/layout';
import { SCORING_THRESHOLDS } from '../scoring/score';
import { dataFingerprint, type RunData } from './fingerprint';

const ids = {
  layoutId: 'logistics',
  exerciseId: 'reverse-bay',
  truckId: 'man-le-18-280',
  trailerId: 'krone-azw-18',
} as const;
const run = resolveRun(ids);
const { exercise } = run;
if (exercise === null) throw new Error('exercise expected');
const data: RunData = {
  params: run.params,
  obstacles: run.layout.obstacles,
  start: run.start,
  exercise,
  scoring: SCORING_THRESHOLDS,
};
const base = run.fingerprint;

const editFirst = (edit: (o: Obstacle) => Obstacle): readonly Obstacle[] =>
  data.obstacles.map((o, i) => (i === 0 ? edit(o) : o));

describe('data fingerprint', () => {
  it('is what resolveRun reports, and stable for the same ids', () => {
    expect(dataFingerprint(data)).toBe(base);
    expect(resolveRun({ ...ids }).fingerprint).toBe(base);
  });

  // Changes only with the data or SIM_REVISION; an accidental key reorder in the hashed constants would show here.
  it('is pinned for one combination', () => {
    expect(base).toBe('a4734945');
  });

  it('differs per vehicle pair, exercise and layout', () => {
    const others = [
      { ...ids, trailerId: 'hueffermann-hpa-24-81-l' },
      { ...ids, truckId: 'arocs-1835-ak' },
      { ...ids, exerciseId: null },
      { ...ids, layoutId: 'depot', exerciseId: null },
    ] as const;
    for (const other of others) expect(resolveRun(other).fingerprint).not.toBe(base);
  });

  it('ignores visual-only content', () => {
    const stop = { kind: 'stop', from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, width: 0.3 } as const;
    const markings = [...exercise.markings, { ...stop, dashed: false }];
    expect(dataFingerprint({ ...data, exercise: { ...exercise, markings } })).toBe(base);
    const taller = editFirst((o) => ({
      ...o,
      id: 'renamed-1',
      height: o.height + 1,
      kind: 'wall',
    }));
    expect(dataFingerprint({ ...data, obstacles: taller })).toBe(base);
  });

  it('depends on obstacle order, which decides the first contact', () => {
    const [first, second, ...rest] = data.obstacles;
    if (!first || !second) throw new Error('two obstacles expected');
    expect(dataFingerprint({ ...data, obstacles: [second, first, ...rest] })).not.toBe(base);
  });

  it('changes with what moves the run or its score', () => {
    const moved = editFirst((o) => ({ ...o, obb: { ...o.obb, cx: o.obb.cx + 0.01 } }));
    const tolerances = { ...exercise.tolerances, position: exercise.tolerances.position + 0.1 };
    const variants: RunData[] = [
      { ...data, params: { ...data.params, drawbar: data.params.drawbar + 0.001 } },
      { ...data, obstacles: moved },
      { ...data, exercise: { ...exercise, tolerances } },
      { ...data, start: { ...data.start, x: data.start.x + 0.001 } },
      { ...data, scoring: { ...data.scoring, WAYPOINT_RADIUS: 4 } },
    ];
    for (const variant of variants) expect(dataFingerprint(variant)).not.toBe(base);
  });
});
