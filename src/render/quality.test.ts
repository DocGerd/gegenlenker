import { describe, expect, it } from 'vitest';
import { GRAPHICS_PRESETS } from '../contracts/render';
import { QUALITY_FLAGS, type QualityFlags } from './quality';

const REALISM: readonly (keyof QualityFlags)[] = [
  'skyline',
  'yardDetail',
  'cabGlb',
  'vehicleGlb',
  'chaseView',
  'cockpitInterior',
  'groundTexture',
  'pbr',
];

describe('quality flags', () => {
  it('defines every preset', () => {
    expect(Object.keys(QUALITY_FLAGS).sort()).toEqual([...GRAPHICS_PRESETS].sort());
  });

  it('keeps balanced at the pre-preset output', () => {
    expect(QUALITY_FLAGS.balanced).toMatchObject({
      pixelRatioCap: 2,
      mirrorMsaa: 4,
      skyline: true,
      yardDetail: true,
      cabGlb: true,
      groundTexture: false,
      pbr: false,
    });
  });

  it('turns every realism flag and the extra cost off on low', () => {
    const low = QUALITY_FLAGS.low;
    expect(low.pixelRatioCap).toBe(1);
    expect(low.mirrorMsaa).toBe(0);
    for (const key of REALISM) expect(low[key], key).toBe(false);
  });

  it('adds only the high-only layers on high', () => {
    expect(QUALITY_FLAGS.high).toEqual({
      ...QUALITY_FLAGS.balanced,
      groundTexture: true,
      pbr: true,
    });
  });
});
