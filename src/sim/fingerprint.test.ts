import { describe, expect, it } from 'vitest';
import { exerciseById, layouts } from '../content/registry';
import { resolveLayout } from '../content/resolve-layout';
import { trailerById, truckById } from '../vehicles/registry';
import { resolveCombination } from '../vehicles/resolve';
import { dataFingerprint } from './fingerprint';

const params = resolveCombination(truckById('man-le-18-280'), trailerById('krone-azw-18'));
const exercise = exerciseById('reverse-bay');
const layout = resolveLayout(layouts[exercise.layout], exercise);

describe('data fingerprint', () => {
  it('is stable for the same data', () => {
    const again = resolveCombination(truckById('man-le-18-280'), trailerById('krone-azw-18'));
    expect(dataFingerprint(params, layout, exercise.start, exercise)).toBe(
      dataFingerprint(
        again,
        resolveLayout(layouts[exercise.layout], exercise),
        exercise.start,
        exercise,
      ),
    );
  });

  it('changes with a vehicle dimension, the content or the start', () => {
    const base = dataFingerprint(params, layout, exercise.start, exercise);
    const longer = { ...params, drawbar: params.drawbar + 0.001 };
    expect(dataFingerprint(longer, layout, exercise.start, exercise)).not.toBe(base);
    const moved = { ...exercise, tolerances: { ...exercise.tolerances, position: 9 } };
    expect(dataFingerprint(params, layout, exercise.start, moved)).not.toBe(base);
    const start = { ...exercise.start, x: exercise.start.x + 0.001 };
    expect(dataFingerprint(params, layout, start, exercise)).not.toBe(base);
  });
});
