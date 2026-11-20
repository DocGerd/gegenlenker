import { Color } from 'three';
import type { ScenePalette } from '../contracts/render';
import {
  legacyIrradiance,
  perspectiveLight,
  perspectiveSunDirection,
  sunPosition,
} from './light-rig';
import { REALISM_HUES } from './realism-hues';
import { createSky, type Sky } from './sky';

/**
 * The verge as an upward-facing Lambert surface lit by the legacy rig, or by the perspective rig
 * when `split`, so the dome below the horizon continues the ground.
 */
export function domeGround(palette: ScenePalette, split: boolean): Color {
  const irradiance = split ? perspectiveLight(palette).groundIrradiance : legacyIrradiance(palette);
  return new Color(palette.verge).multiplyScalar(Math.min(1, irradiance / Math.PI));
}

/**
 * The dome the perspective views show; the vehicle reflections are captured from the same one,
 * with `tone` off, since the material reading the capture tone-maps it.
 */
export function createSceneSky(palette: ScenePalette, tone = true): Sky {
  return createSky(
    new Color(palette.sky),
    domeGround(palette, false),
    new Color(REALISM_HUES.skyHaze),
    new Color(REALISM_HUES.sunHalo),
    sunPosition(),
    { ...perspectiveLight(palette), sun: perspectiveSunDirection(), tone },
  );
}
