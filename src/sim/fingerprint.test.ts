import { describe, expect, it } from 'vitest';
import { exerciseById, layouts } from '../content/registry';
import { resolveLayout } from '../content/resolve-layout';
import type { Obstacle } from '../contracts/layout';
import { trailerById, truckById } from '../vehicles/registry';
import { resolveCombination } from '../vehicles/resolve';
import { dataFingerprint, type RunData } from './fingerprint';

const exercise = exerciseById('reverse-bay');
const data: RunData = {
  params: resolveCombination(truckById('man-le-18-280'), trailerById('krone-azw-18')),
  obstacles: resolveLayout(layouts[exercise.layout], exercise).obstacles,
  start: exercise.start,
  exercise,
  scoring: { waypointRadius: 3, stoppedSpeed: 0.05 },
};
const base = dataFingerprint(data);

const editFirst = (edit: (o: Obstacle) => Obstacle): readonly Obstacle[] =>
  data.obstacles.map((o, i) => (i === 0 ? edit(o) : o));

describe('data fingerprint', () => {
  it('is stable for the same data', () => {
    const params = resolveCombination(truckById('man-le-18-280'), trailerById('krone-azw-18'));
    expect(dataFingerprint({ ...data, params })).toBe(base);
  });

  it('ignores visual-only content', () => {
    const stop = { kind: 'stop', from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, width: 0.3 } as const;
    const markings = [...exercise.markings, { ...stop, dashed: false }];
    expect(dataFingerprint({ ...data, exercise: { ...exercise, markings } })).toBe(base);
    const taller = editFirst((o) => ({ ...o, height: o.height + 1, kind: 'wall' }));
    expect(dataFingerprint({ ...data, obstacles: taller })).toBe(base);
  });

  it('changes with what moves the run or its score', () => {
    const moved = editFirst((o) => ({ ...o, obb: { ...o.obb, cx: o.obb.cx + 0.01 } }));
    const tolerances = { ...exercise.tolerances, position: exercise.tolerances.position + 0.1 };
    const variants: RunData[] = [
      { ...data, params: { ...data.params, drawbar: data.params.drawbar + 0.001 } },
      { ...data, obstacles: moved },
      { ...data, exercise: { ...exercise, tolerances } },
      { ...data, start: { ...data.start, x: data.start.x + 0.001 } },
      { ...data, scoring: { ...data.scoring, waypointRadius: 4 } },
    ];
    for (const variant of variants) expect(dataFingerprint(variant)).not.toBe(base);
  });
});
