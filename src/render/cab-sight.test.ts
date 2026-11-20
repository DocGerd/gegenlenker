import { describe, expect, it } from 'vitest';
import type { TruckSpec } from '../contracts/vehicle';
import { trucks } from '../vehicles/registry';
import { cabSight } from './cab-sight';

const centred = (spec: TruckSpec): TruckSpec => ({
  ...spec,
  eye: { ...spec.eye, leftOfCentre: { ...spec.eye.leftOfCentre, value: 0 } },
});

describe.each(trucks)('cab sight of $id', (spec) => {
  const sight = cabSight(spec);

  it('shows the windscreen centre to the right of the view axis', () => {
    expect(sight.windscreenCentre).toBeGreaterThan(0);
  });

  it('has the left pillar nearer the axis and wider than the right', () => {
    expect(sight.left.inner).toBeLessThan(sight.right.inner);
    expect(sight.left.outer).toBeLessThan(sight.right.outer);
    expect(sight.left.covered).toBeGreaterThan(sight.right.covered);
    expect(sight.right.covered).toBeGreaterThan(0);
  });

  it('is symmetric for an eye on the centre line', () => {
    const middle = cabSight(centred(spec));
    expect(middle.windscreenCentre).toBe(0);
    expect(middle.left).toEqual(middle.right);
  });
});
