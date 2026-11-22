import { describe, expect, it } from 'vitest';
import { GRAPHICS_PRESETS } from '../contracts/render';
import { QUALITY_FLAGS, type QualityFlags } from './quality';

/** Flags whose asset is a download: the tablet preset must not pay for them. A new one is added here. */
const DOWNLOADS: readonly (keyof QualityFlags)[] = [
  'groundTexture',
  'groundPbr',
  'hdriSky',
  'yardKit',
  'interiorGlb',
];

/** Flags High adds over Balanced that cost compute only: each new High-only flag is classified here or in DOWNLOADS. */
const COMPUTE_ONLY: readonly (keyof QualityFlags)[] = [
  'pbr',
  'perspectiveLighting',
  'aerialPerspective',
  'sunShadow',
  'lampShadow',
  'yardShadow',
];

/** Flags that stay on at every preset, Low included: they cost a pass, not realism, and the tablet check measures them. */
const ALWAYS_ON: readonly (keyof QualityFlags)[] = ['frontMirror', 'wideMirrors'];

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
    for (const [key, flag] of Object.entries(low)) {
      if (typeof flag === 'boolean')
        expect(flag, key).toBe(ALWAYS_ON.includes(key as keyof QualityFlags));
    }
    for (const preset of GRAPHICS_PRESETS) {
      for (const key of ALWAYS_ON)
        expect(QUALITY_FLAGS[preset][key], `${preset} ${key}`).toBe(true);
    }
  });

  it('draws the class V mirror on balanced and high, not on low', () => {
    expect(QUALITY_FLAGS.balanced.closeMirror).toBe(true);
    expect(QUALITY_FLAGS.high.closeMirror).toBe(true);
    expect(QUALITY_FLAGS.low.closeMirror).toBe(false);
  });

  it('differs from balanced on high only in classified flags', () => {
    const classified: readonly string[] = [...DOWNLOADS, ...COMPUTE_ONLY];
    const changed = (Object.keys(QUALITY_FLAGS.high) as (keyof QualityFlags)[]).filter(
      (key) => QUALITY_FLAGS.high[key] !== QUALITY_FLAGS.balanced[key],
    );
    for (const key of changed) expect(classified, key).toContain(key);
    for (const key of classified)
      expect(QUALITY_FLAGS.high[key as keyof QualityFlags], key).toBe(true);
    expect(DOWNLOADS).toEqual(
      expect.arrayContaining(['groundTexture', 'groundPbr', 'hdriSky', 'yardKit']),
    );
    for (const key of DOWNLOADS) expect(QUALITY_FLAGS.balanced[key], key).toBe(false);
  });

  it('draws the PBR ground only over the detail ground', () => {
    for (const preset of GRAPHICS_PRESETS) {
      const flags = QUALITY_FLAGS[preset];
      if (flags.groundPbr) expect(flags.groundTexture, preset).toBe(true);
    }
    expect(GRAPHICS_PRESETS.filter((p) => QUALITY_FLAGS[p].groundPbr)).toEqual(['high']);
  });

  it('hazes only graded views, on High', () => {
    expect(QUALITY_FLAGS.high.aerialPerspective).toBe(true);
    for (const preset of GRAPHICS_PRESETS) {
      const flags = QUALITY_FLAGS[preset];
      if (flags.aerialPerspective) expect(flags.perspectiveLighting, preset).toBe(true);
    }
    expect(GRAPHICS_PRESETS.filter((p) => QUALITY_FLAGS[p].aerialPerspective)).toEqual(['high']);
  });

  it('shadows only lit views, on High', () => {
    expect(GRAPHICS_PRESETS.filter((p) => QUALITY_FLAGS[p].sunShadow)).toEqual(['high']);
    for (const preset of GRAPHICS_PRESETS) {
      const flags = QUALITY_FLAGS[preset];
      if (flags.sunShadow) expect(flags.perspectiveLighting, preset).toBe(true);
    }
  });

  it("casts the lamps' shadows only where the lamps light the ground, on High", () => {
    expect(GRAPHICS_PRESETS.filter((p) => QUALITY_FLAGS[p].lampShadow)).toEqual(['high']);
    for (const preset of GRAPHICS_PRESETS) {
      const flags = QUALITY_FLAGS[preset];
      if (flags.lampShadow) expect(flags.lampLight, preset).toBe(true);
    }
  });

  it("casts the yard's shadows only where the masts are lights, on High", () => {
    expect(GRAPHICS_PRESETS.filter((p) => QUALITY_FLAGS[p].yardShadow)).toEqual(['high']);
    for (const preset of GRAPHICS_PRESETS) {
      const flags = QUALITY_FLAGS[preset];
      if (flags.yardShadow) {
        expect(flags.yardLight, preset).toBe(true);
        expect(flags.perspectiveLighting, preset).toBe(true);
      }
    }
  });

  it('tone-maps every reflection: pbr with the HDRI sky needs the grade', () => {
    // the reflection capture is untoned; only the graded reflective material maps it
    for (const preset of GRAPHICS_PRESETS) {
      const flags = QUALITY_FLAGS[preset];
      if (flags.pbr && flags.hdriSky) expect(flags.perspectiveLighting, preset).toBe(true);
    }
  });
});
