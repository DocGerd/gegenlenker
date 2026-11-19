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
  'perspectiveLighting',
  'aerialPerspective',
  'hdriSky',
];

/** Flags whose asset is a download: the tablet preset must not pay for them. A new one is added here. */
const DOWNLOADS: readonly (keyof QualityFlags)[] = ['groundTexture', 'hdriSky'];

/** Flags High adds over Balanced that cost compute only: each new High-only flag is classified here or in DOWNLOADS. */
const COMPUTE_ONLY: readonly (keyof QualityFlags)[] = [
  'pbr',
  'perspectiveLighting',
  'aerialPerspective',
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
      perspectiveLighting: true,
      aerialPerspective: true,
      hdriSky: true,
    });
  });

  it('downloads nothing extra on balanced', () => {
    const highOnly = (Object.keys(QUALITY_FLAGS.high) as (keyof QualityFlags)[]).filter(
      (key) => QUALITY_FLAGS.high[key] === true && QUALITY_FLAGS.balanced[key] === false,
    );
    for (const key of highOnly) expect([...DOWNLOADS, ...COMPUTE_ONLY], key).toContain(key);
    expect(DOWNLOADS).toEqual(expect.arrayContaining(['groundTexture', 'hdriSky']));
    for (const key of DOWNLOADS) expect(QUALITY_FLAGS.balanced[key], key).toBe(false);
  });

  it('hazes only graded views, on High', () => {
    expect(QUALITY_FLAGS.high.aerialPerspective).toBe(true);
    for (const preset of GRAPHICS_PRESETS) {
      const flags = QUALITY_FLAGS[preset];
      if (flags.aerialPerspective) expect(flags.perspectiveLighting, preset).toBe(true);
    }
    expect(GRAPHICS_PRESETS.filter((p) => QUALITY_FLAGS[p].aerialPerspective)).toEqual(['high']);
  });

  it('tone-maps every reflection: pbr with the HDRI sky needs the grade', () => {
    // the reflection capture is untoned; only the graded reflective material maps it
    for (const preset of GRAPHICS_PRESETS) {
      const flags = QUALITY_FLAGS[preset];
      if (flags.pbr && flags.hdriSky) expect(flags.perspectiveLighting, preset).toBe(true);
    }
  });
});
