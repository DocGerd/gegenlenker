import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Color } from 'three';
import { describe, expect, it } from 'vitest';
import { GRAPHICS_PRESETS } from '../contracts/render';
import { FOG_DENSITY, GRADE } from './grade';
import { NIGHT_AMBIENT, NIGHT_TINT, perspectiveSunDirection } from './light-rig';
import { applyLook, lookFor } from './look';
import { KEYS, tokenName } from './palette';
import { QUALITY_FLAGS } from './quality';
import type { ScenePaletteKey } from '../contracts/render';

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

  it.each(GRAPHICS_PRESETS)('the day look of %s changes nothing the flags did not', (preset) => {
    const flags = QUALITY_FLAGS[preset];
    const look = lookFor(flags, 'day');
    expect(look.litCopies).toBe(flags.litMarkings);
    expect(look.aidGlow).toBe(false);
    expect(look.rig).toEqual({ sun: 1, ambient: 1, tint: null });
    expect(look.sky).toBe('day');
    expect(look.lamps).toBe(false);
    expect(look.shadow).toBe(flags.sunShadow && flags.perspectiveLighting);
  });

  it.each(GRAPHICS_PRESETS)(
    'the night look of %s is the same lit scene on every preset',
    (preset) => {
      const flags = QUALITY_FLAGS[preset];
      const look = lookFor(flags, 'night');
      expect(look.flags).toBe(flags);
      expect(look.lightSplit).toBe(true);
      expect(look.litCopies).toBe(true);
      expect(look.aidGlow).toBe(true);
      expect(look.rig).toEqual({ sun: 0, ambient: NIGHT_AMBIENT, tint: NIGHT_TINT });
      expect(look.sky).toBe('night');
      expect(look.lamps).toBe(true);
      expect(look.shadow).toBe(false);
      expect(look.grade.on).toBe(flags.perspectiveLighting);
      expect(look.grade.exposure).toBe(1);
      expect(look.grade.skyHdri).toBe(0);
      expect(look.grade.fogDensity).toBe(flags.aerialPerspective ? FOG_DENSITY : 0);
    },
  );
});

describe('the night yard', () => {
  const css = readFileSync(join(import.meta.dirname, '../styles/tokens.css'), 'utf8');
  const token = (key: ScenePaletteKey): number => {
    const hex = new RegExp(`--scene-${tokenName(key)}:\\s*#([0-9a-f]{6});`, 'i').exec(css)?.[1];
    if (hex === undefined) throw new Error(`--scene-${tokenName(key)} missing`);
    return parseInt(hex, 16);
  };
  // an upward Lambert surface under the night ambient, as the 8-bit sRGB intermediate stores it
  const code = (key: ScenePaletteKey): number[] => {
    const lit = new Color(token(key))
      .multiply(new Color(...NIGHT_TINT))
      .multiplyScalar(NIGHT_AMBIENT);
    return [lit.getHex() >> 16, (lit.getHex() >> 8) & 255, lit.getHex() & 255];
  };
  const lit = (Object.keys(KEYS) as ScenePaletteKey[]).filter(
    (k) => k !== 'sky' && k !== 'backdrop' && k !== 'nightBackdrop',
  );

  it('keeps at least 12 distinct codes across the surfaces, so the dark does not band', () => {
    const luma = new Set(lit.map((k) => Math.max(...code(k))));
    expect(luma.size).toBeGreaterThanOrEqual(12);
  });

  it('keeps the grounds apart and above the black floor', () => {
    const grounds = (['yard', 'pavement', 'street', 'verge'] as const).map((k) =>
      Math.max(...code(k)),
    );
    expect(new Set(grounds).size).toBe(4);
    for (const g of grounds) expect(g).toBeGreaterThanOrEqual(16);
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

  it('keeps the cab interior at full light by day', () => {
    const look = lookFor(QUALITY_FLAGS.high, 'day');
    expect(look.interior.light).toBe(1);
    applyLook({ ...look, interior: { light: 0.25 } }, { toward: new Color(), away: new Color() });
    expect(GRADE.interiorLight.value).toBe(0.25);
    applyLook(look, { toward: new Color(), away: new Color() });
    expect(GRADE.interiorLight.value).toBe(1);
  });
});

describe('the grade uniforms', () => {
  // any member access on a uniform (`.value`, `.value.setHex(`), also across lines; the shaders take the nodes
  const reached = /\bGRADE\s*\.\s*\w+\s*\.\s*\w+/;
  const root = import.meta.dirname;

  it('are reached from look.ts alone, the shaders in grade.ts aside', () => {
    const offenders = readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .filter((f) => f !== 'look.ts' && f !== 'grade.ts')
      .filter((f) => reached.test(readFileSync(join(root, f), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('are found by the pattern in look.ts and in planted writes', () => {
    expect(reached.test(readFileSync(join(root, 'look.ts'), 'utf8'))).toBe(true);
    for (const write of [
      'GRADE.exposure.value *= 2',
      'GRADE.hazeToward.value.setHex(1)',
      'GRADE\n  .sunDirection\n  .value.normalize()',
    ]) {
      expect(reached.test(write), write).toBe(true);
    }
  });
});
