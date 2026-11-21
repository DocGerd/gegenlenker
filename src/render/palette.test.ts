import { describe, expect, it } from 'vitest';
import type { ScenePalette } from '../contracts/render';
import { KEYS, NIGHT_KEY, nightPalette, tokenName } from './palette';

describe('nightPalette', () => {
  const palette = Object.fromEntries(
    Object.keys(KEYS).map((key, i) => [key, i + 1]),
  ) as unknown as ScenePalette;
  const night = nightPalette(palette);

  it('takes each lit key from its night token', () => {
    for (const [key, token] of Object.entries(NIGHT_KEY)) {
      expect(night[key as keyof ScenePalette], key).toBe(palette[token]);
    }
  });

  it('leaves every other key alone', () => {
    const lit = new Set(Object.keys(NIGHT_KEY));
    for (const key of Object.keys(KEYS) as (keyof ScenePalette)[]) {
      if (!lit.has(key)) expect(night[key], key).toBe(palette[key]);
    }
  });

  it('names the night tokens --scene-night-<key>', () => {
    expect(tokenName(NIGHT_KEY.yard)).toBe('night-yard');
  });
});
