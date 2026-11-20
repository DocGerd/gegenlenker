import { Color } from 'three';
import { describe, expect, it } from 'vitest';
import type { ScenePalette } from '../contracts/render';
import { NIGHT_AMBIENT, NIGHT_TINT } from './light-rig';
import { KEYS } from './palette';
import { REALISM_HUES } from './realism-hues';
import { nightDomeGround, skyColours } from './scene-sky';
import { zenithOf } from './sky';

const palette = Object.fromEntries(Object.keys(KEYS).map((k) => [k, 0x808080])) as ScenePalette;

describe('skyColours', () => {
  it('draws the day dome from the palette sky, the haze and the sun halo', () => {
    const day = skyColours(palette, 'day');
    expect(day.horizon.getHex()).toBe(palette.sky);
    expect(day.zenith).toEqual(zenithOf(day.horizon));
    expect(day.haze.getHex()).toBe(REALISM_HUES.skyHaze);
    expect(day.halo.getHex()).toBe(REALISM_HUES.sunHalo);
  });

  it('draws the night dome from its two hues, fading to the horizon and with no sun halo', () => {
    const night = skyColours(palette, 'night');
    expect(night.horizon.getHex()).toBe(REALISM_HUES.nightHorizon);
    expect(night.zenith.getHex()).toBe(REALISM_HUES.nightZenith);
    expect(night.haze).toEqual(night.horizon);
    expect(night.halo.getHex()).toBe(0);
  });

  it('continues the verge below the night horizon under the night ambient', () => {
    const verge = new Color(palette.verge).toArray();
    const ground = nightDomeGround(palette).toArray();
    NIGHT_TINT.forEach((t, i) => {
      expect(ground[i]).toBeCloseTo((verge[i] ?? 0) * t * NIGHT_AMBIENT, 8);
    });
  });
});
