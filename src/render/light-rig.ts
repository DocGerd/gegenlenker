import {
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  LightProbe,
  SphericalHarmonics3,
  Vector3,
} from 'three';
import type { ScenePalette } from '../contracts/render';
import { HDRI_LIGHT } from './hdri-light';
import { AIDS_LAYER, DEFAULT_LAYER, SKY_LAYER } from './seams';
import { neutralSky } from './sky';

export const SUN_ELEVATION = (50 * Math.PI) / 180;
const SUN_DISTANCE = 100;
export const SUN_INTENSITY = 2.4;
export const HEMISPHERE_INTENSITY = 1.4;
/** SH9 basis constants of band 0 and the y term of band 1 (three's `getBasisAt`). */
const SH_Y00 = 0.282095;
const SH_Y10 = 0.488603;

/** The legacy sun's position relative to the origin: south-west, where world (−, −) is Three (−x, +z). */
export function sunPosition(): Vector3 {
  const horizontal = Math.cos(SUN_ELEVATION) * SUN_DISTANCE;
  return new Vector3(
    -horizontal / Math.SQRT2,
    Math.sin(SUN_ELEVATION) * SUN_DISTANCE,
    horizontal / Math.SQRT2,
  );
}

/** Irradiance the legacy rig puts on an upward-facing surface. */
export function legacyIrradiance(palette: ScenePalette): number {
  return HEMISPHERE_INTENSITY * neutralSky(palette.sky).r + SUN_INTENSITY * Math.sin(SUN_ELEVATION);
}

/** Unit vector towards the HDRI's sun, turned to the legacy sun's azimuth. */
export function perspectiveSunDirection(): Vector3 {
  const { elevation } = HDRI_LIGHT.sun;
  const { azimuth } = HDRI_LIGHT;
  const horizontal = Math.cos(elevation);
  return new Vector3(
    horizontal * Math.cos(azimuth),
    Math.sin(elevation),
    horizontal * Math.sin(azimuth),
  );
}

export type PerspectiveLight = {
  /**
   * Scene radiance per HDRI unit, per channel: upward-facing surfaces get the legacy irradiance,
   * white-balanced so a sunlit horizontal surface keeps its token hue.
   */
  readonly scale: Color;
  readonly sunColor: Color;
  readonly sunIntensity: number;
  /** Sky SH plus the yard's bounce from below. */
  readonly sh: SphericalHarmonics3;
  readonly hazeToward: Color;
  readonly hazeAway: Color;
};

/**
 * The HDRI's sun/sky split at the legacy rig's horizontal irradiance, so layer-0 tokens, which are
 * not tone-mapped, stay as bright and as neutral as before, and below 1 in the 8-bit intermediate.
 */
export function perspectiveLight(palette: ScenePalette): PerspectiveLight {
  const { sun, skySh, horizonToward, horizonAway } = HDRI_LIGHT;
  const total = legacyIrradiance(palette);
  const sh = new SphericalHarmonics3();
  skySh.forEach(([r, g, b], i) => sh.coefficients[i]?.set(r, g, b));
  const up = sh.getIrradianceAt(new Vector3(0, 1, 0), new Vector3());
  const sunUp = sun.irradiance * Math.sin(sun.elevation);
  const [sr, sg, sb] = sun.colour;
  const scale = new Color(
    total / (up.x + sr * sunUp),
    total / (up.y + sg * sunUp),
    total / (up.z + sb * sunUp),
  );
  const gain = new Vector3(scale.r, scale.g, scale.b);
  for (const c of sh.coefficients) c.multiply(gain);
  // a uniform radiance below the horizon only reaches band 0 and the y term of band 1
  const bounce = new Color(palette.yard).multiplyScalar(total / Math.PI);
  const bounceVector = new Vector3(bounce.r, bounce.g, bounce.b);
  sh.coefficients[0]?.addScaledVector(bounceVector, SH_Y00 * 2 * Math.PI);
  sh.coefficients[1]?.addScaledVector(bounceVector, -SH_Y10 * Math.PI);
  const sunColor = new Color(...sun.colour).multiply(scale);
  const sunLuminance = 0.2126 * sunColor.r + 0.7152 * sunColor.g + 0.0722 * sunColor.b;
  return {
    scale,
    sunColor: sunColor.multiplyScalar(1 / sunLuminance),
    sunIntensity: sun.irradiance * sunLuminance,
    sh,
    hazeToward: new Color(...horizonToward).multiply(scale),
    hazeAway: new Color(...horizonAway).multiply(scale),
  };
}

export type LightRig = {
  readonly object: Group;
  /**
   * On: the legacy lights move to the top-down camera only and the HDRI rig lights the perspective
   * views. Separate from the quality flag, so night can force the split on every preset.
   */
  setSplit(on: boolean): void;
  /** Scales the perspective rig (night dims it); the light set stays constant. */
  setIntensity(share: number): void;
};

export function createLightRig(palette: ScenePalette): LightRig {
  const legacySun = new DirectionalLight(0xffffff, SUN_INTENSITY);
  legacySun.position.copy(sunPosition());
  const legacyAmbient = new HemisphereLight(
    neutralSky(palette.sky),
    palette.verge,
    HEMISPHERE_INTENSITY,
  );

  const light = perspectiveLight(palette);
  const sun = new DirectionalLight(light.sunColor, light.sunIntensity);
  sun.position.copy(perspectiveSunDirection().multiplyScalar(SUN_DISTANCE));
  const probe = new LightProbe(light.sh, 1);
  for (const l of [sun, probe]) {
    l.layers.set(SKY_LAYER);
    l.visible = false;
  }

  const object = new Group();
  object.add(legacySun, legacyAmbient, sun, probe);
  return {
    object,
    setSplit(on) {
      for (const l of [legacySun, legacyAmbient]) l.layers.set(on ? AIDS_LAYER : DEFAULT_LAYER);
      sun.visible = on;
      probe.visible = on;
    },
    setIntensity(share) {
      sun.intensity = light.sunIntensity * share;
      probe.intensity = share;
    },
  };
}
