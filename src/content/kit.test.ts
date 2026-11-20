import { describe, expect, it } from 'vitest';
import { KIT_FOOTPRINTS, kitFootprint } from './kit';

describe('kitFootprint', () => {
  it('turns an off-centre piece about its origin', () => {
    // the canopy stands 6 m behind its face line: with +Y facing west it reaches east
    const f = kitFootprint('wash-canopy', 100, 20, Math.PI / 2);
    expect(f.cx).toBeCloseTo(103, 9);
    expect(f.cy).toBeCloseTo(20, 9);
    expect(f.halfLength).toBeCloseTo(4.2, 9);
    expect(f.halfWidth).toBeCloseTo(3.2, 9);
    expect(f.heading).toBe(Math.PI / 2);
  });

  it('keeps a symmetric piece centred on its origin at any heading', () => {
    const f = kitFootprint('hall-wall-bay', 7, -3, 1.1);
    const { min, max } = KIT_FOOTPRINTS['hall-wall-bay'];
    expect(f.halfLength).toBeCloseTo((max[0] - min[0]) / 2, 9);
    expect(Math.hypot(f.cx - 7, f.cy + 3)).toBeCloseTo(Math.abs((min[1] + max[1]) / 2), 9);
  });

  it('stretches a roof along its Y and no other piece', () => {
    expect(kitFootprint('hall-roof', 0, 0, 0, 10)).toMatchObject({ cy: -5, halfWidth: 5 });
    expect(kitFootprint('hall-wall-bay', 0, 0, 0, 10).halfWidth).toBeCloseTo(0.24, 9);
  });
});
