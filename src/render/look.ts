import type { Color, Vector3 } from 'three';
import type { LightingMode } from '../contracts/render';
import { FOG_DENSITY, GRADE } from './grade';
import { NIGHT_AMBIENT, NIGHT_TINT, perspectiveSunDirection, type RigLevels } from './light-rig';
import type { QualityFlags } from './quality';

/** What the perspective renderer applies, derived from the quality flags and the lighting mode. */
export type Look = {
  readonly flags: QualityFlags;
  readonly mode: LightingMode;
  /** The legacy lights serve the top-down view only and the HDRI rig lights the perspective views. */
  readonly lightSplit: boolean;
  /** Lit perspective copies of the flat ground markings and aids; off, the unlit tokens draw in every view. */
  readonly litCopies: boolean;
  /** The perspective aids (target outline, tolerance band, gate) draw unlit, in their token colours. */
  readonly aidGlow: boolean;
  readonly rig: RigLevels;
  /** Which dome and haze the perspective views show. */
  readonly sky: LightingMode;
  /** The lamp lenses of the vehicles are lit. */
  readonly lamps: boolean;
  /** The HDRI sun casts a shadow; the contact blobs stay while it does not. */
  readonly shadow: boolean;
  readonly grade: {
    /** Fog and tone mapping in the perspective-only lit materials. */
    readonly on: boolean;
    readonly exposure: number;
    readonly fogDensity: number;
    readonly skyHdri: number;
    readonly sunDirection: Vector3;
  };
};

const DAY_RIG: RigLevels = { sun: 1, ambient: 1, tint: null };

export function lookFor(flags: QualityFlags, mode: LightingMode): Look {
  const night = mode === 'night';
  return {
    flags,
    mode,
    lightSplit: flags.perspectiveLighting || night,
    litCopies: flags.litMarkings || night,
    aidGlow: night,
    rig: night ? { sun: 0, ambient: NIGHT_AMBIENT, tint: NIGHT_TINT } : DAY_RIG,
    sky: mode,
    lamps: night,
    shadow: flags.sunShadow && flags.perspectiveLighting && !night,
    grade: {
      on: flags.perspectiveLighting,
      exposure: 1,
      fogDensity: flags.aerialPerspective ? FOG_DENSITY : 0,
      // the HDRI stays attached at night, so its marker resolves; the dome just stops showing it
      skyHdri: night ? 0 : 1,
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
