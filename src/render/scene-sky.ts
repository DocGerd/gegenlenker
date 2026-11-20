import { Color } from 'three';
import type { LightingMode, ScenePalette } from '../contracts/render';
import {
  legacyIrradiance,
  NIGHT_AMBIENT,
  NIGHT_TINT,
  perspectiveLight,
  perspectiveSunDirection,
  sunPosition,
} from './light-rig';
import { REALISM_HUES } from './realism-hues';
import { createSky, type Sky, type SkyColours, zenithOf } from './sky';

/**
 * The verge as an upward-facing Lambert surface lit by the legacy rig, or by the perspective rig
 * when `split`, so the dome below the horizon continues the ground.
 */
export function domeGround(palette: ScenePalette, split: boolean): Color {
  const irradiance = split ? perspectiveLight(palette).groundIrradiance : legacyIrradiance(palette);
  return new Color(palette.verge).multiplyScalar(Math.min(1, irradiance / Math.PI));
}

/** The verge under the night ambient light alone. */
export function nightDomeGround(palette: ScenePalette): Color {
  return new Color(palette.verge).multiply(new Color(...NIGHT_TINT).multiplyScalar(NIGHT_AMBIENT));
}

/** The analytic dome's colours: the day sky from the palette, the night one from its two hues and no sun halo. */
export function skyColours(palette: ScenePalette, mode: LightingMode): SkyColours {
  if (mode === 'night') {
    const horizon = new Color(REALISM_HUES.nightHorizon);
    return {
      horizon,
      zenith: new Color(REALISM_HUES.nightZenith),
      haze: horizon.clone(),
      halo: new Color(0, 0, 0),
    };
  }
  const horizon = new Color(palette.sky);
  return {
    horizon,
    zenith: zenithOf(horizon),
    haze: new Color(REALISM_HUES.skyHaze),
    halo: new Color(REALISM_HUES.sunHalo),
  };
}

/**
 * The dome the perspective views show; the vehicle reflections are captured from the same one,
 * with `tone` off, since the material reading the capture tone-maps it.
 */
export function createSceneSky(
  palette: ScenePalette,
  tone = true,
  mode: LightingMode = 'day',
): Sky {
  const { horizon, zenith, haze, halo } = skyColours(palette, mode);
  return createSky(
    horizon,
    mode === 'night' ? nightDomeGround(palette) : domeGround(palette, false),
    haze,
    halo,
    sunPosition(),
    { ...perspectiveLight(palette), sun: perspectiveSunDirection(), tone },
    zenith,
  );
}
