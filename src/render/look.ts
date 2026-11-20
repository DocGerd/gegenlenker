import type { Color, Vector3 } from 'three';
import type { LightingMode } from '../contracts/render';
import { FOG_DENSITY, GRADE } from './grade';
import { perspectiveSunDirection } from './light-rig';
import type { QualityFlags } from './quality';

/** What the perspective renderer applies, derived from the quality flags and the lighting mode. */
export type Look = {
  readonly flags: QualityFlags;
  readonly mode: LightingMode;
  /** The legacy lights serve the top-down view only and the HDRI rig lights the perspective views. */
  readonly lightSplit: boolean;
  readonly grade: {
    /** Fog and tone mapping in the perspective-only lit materials. */
    readonly on: boolean;
    readonly exposure: number;
    readonly fogDensity: number;
    readonly skyHdri: number;
    readonly sunDirection: Vector3;
  };
};

export function lookFor(flags: QualityFlags, mode: LightingMode): Look {
  const night = mode === 'night';
  return {
    flags,
    mode,
    lightSplit: flags.perspectiveLighting || night,
    grade: {
      on: flags.perspectiveLighting,
      exposure: 1,
      fogDensity: flags.aerialPerspective ? FOG_DENSITY : 0,
      skyHdri: 1,
      sunDirection: perspectiveSunDirection(),
    },
  };
}

/** The distance haze colours seen towards the sun and away from it. */
export type Haze = { readonly toward: Color; readonly away: Color };

/** The only writer of `GRADE`: its uniforms are shared by every graded material. */
export function applyLook(look: Look, haze: Haze): void {
  GRADE.exposure.value = look.grade.exposure;
  GRADE.fogDensity.value = look.grade.fogDensity;
  GRADE.skyHdri.value = look.grade.skyHdri;
  GRADE.sunDirection.value.copy(look.grade.sunDirection);
  GRADE.hazeToward.value.copy(haze.toward);
  GRADE.hazeAway.value.copy(haze.away);
}
