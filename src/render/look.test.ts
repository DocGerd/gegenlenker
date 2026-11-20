import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Color } from 'three';
import { describe, expect, it } from 'vitest';
import { GRAPHICS_PRESETS } from '../contracts/render';
import { FOG_DENSITY, GRADE } from './grade';
import { perspectiveSunDirection } from './light-rig';
import { applyLook, lookFor } from './look';
import { QUALITY_FLAGS } from './quality';

describe('lookFor', () => {
  it.each(GRAPHICS_PRESETS)('the day look of %s is what the flags have always driven', (preset) => {
    const flags = QUALITY_FLAGS[preset];
    const look = lookFor(flags, 'day');
    expect(look.flags).toBe(flags);
    expect(look.lightSplit).toBe(flags.perspectiveLighting);
    expect(look.grade.on).toBe(flags.perspectiveLighting);
    expect(look.grade.fogDensity).toBe(flags.aerialPerspective ? FOG_DENSITY : 0);
    expect(look.grade.exposure).toBe(1);
    expect(look.grade.skyHdri).toBe(1);
    expect(look.grade.sunDirection).toEqual(perspectiveSunDirection());
  });

  it('splits the lights at night on every preset without grading', () => {
    for (const preset of GRAPHICS_PRESETS) {
      const look = lookFor(QUALITY_FLAGS[preset], 'night');
      expect(look.lightSplit, preset).toBe(true);
      expect(look.grade.on, preset).toBe(QUALITY_FLAGS[preset].perspectiveLighting);
    }
  });
});

describe('applyLook', () => {
  it('writes the grade uniforms from the look and the haze given', () => {
    const toward = new Color(0x112233);
    const away = new Color(0x445566);
    const look = lookFor(QUALITY_FLAGS.high, 'day');
    applyLook(
      { ...look, grade: { ...look.grade, exposure: 0.5, skyHdri: 0.25 } },
      { toward, away },
    );
    expect(GRADE.exposure.value).toBe(0.5);
    expect(GRADE.skyHdri.value).toBe(0.25);
    expect(GRADE.fogDensity.value).toBe(FOG_DENSITY);
    expect(GRADE.sunDirection.value).toEqual(look.grade.sunDirection);
    expect(GRADE.hazeToward.value.getHex()).toBe(0x112233);
    expect(GRADE.hazeAway.value.getHex()).toBe(0x445566);
    applyLook(look, { toward, away });
    expect(GRADE.exposure.value).toBe(1);
  });
});

describe('the grade uniforms', () => {
  it('are written by look.ts alone', () => {
    const root = import.meta.dirname;
    const written =
      /\bGRADE\.\w+\.value\s*=(?!=)|\bGRADE\.\w+\.value\.(?:copy|set|add|sub|multiply\w*|lerp\w*)\(/;
    const offenders = readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'look.ts')
      .filter((f) => written.test(readFileSync(join(root, f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
