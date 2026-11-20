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
import { AIDS_LAYER, DEFAULT_LAYER, PERSPECTIVE_LAYER, type ShadowFocus } from './seams';
import { neutralSky } from './sky';
import { fitSunShadow, prepareShadow, queueShadow, SUN_DISTANCE } from './sun-shadow';

export const SUN_ELEVATION = (50 * Math.PI) / 180;
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
  /** Irradiance on an upward-facing surface, the same in every channel. */
  readonly groundIrradiance: number;
  /** Sky SH plus the yard's bounce from below. */
  readonly sh: SphericalHarmonics3;
  readonly hazeToward: Color;
  readonly hazeAway: Color;
};

/** Fibonacci-sphere directions the peak irradiance is searched over. */
const PEAK_SAMPLES = 4096;
/** Share of the 8-bit top the brightest normal may reach; covers the gaps between the samples. */
const PEAK_HEADROOM = 0.99;

/** Highest channel of the irradiance over all normals. */
function peakIrradiance(
  sh: SphericalHarmonics3,
  sun: Vector3,
  sunColor: Color,
  sunIntensity: number,
): number {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const normal = new Vector3();
  const e = new Vector3();
  let peak = 0;
  for (let i = 0; i < PEAK_SAMPLES; i++) {
    const y = 1 - (2 * (i + 0.5)) / PEAK_SAMPLES;
    const r = Math.sqrt(1 - y * y);
    normal.set(r * Math.cos(golden * i), y, r * Math.sin(golden * i));
    sh.getIrradianceAt(normal, e);
    const direct = Math.max(0, normal.dot(sun)) * sunIntensity;
    peak = Math.max(
      peak,
      e.x + sunColor.r * direct,
      e.y + sunColor.g * direct,
      e.z + sunColor.b * direct,
    );
  }
  return peak;
}

type Rgb = readonly [number, number, number];

/** The generated bake, widened so a malformed one fails here instead of as a black or NaN light. */
function bakedSh(skySh: readonly Rgb[]): SphericalHarmonics3 {
  if (skySh.length !== 9) throw new Error('HDRI_LIGHT.skySh needs nine coefficients');
  const sh = new SphericalHarmonics3();
  skySh.forEach(([r, g, b], i) => sh.coefficients[i]?.set(r, g, b));
  return sh;
}

/**
 * The HDRI's sun/sky split at the legacy rig's horizontal irradiance, lowered as a whole where a
 * normal between the sun and the zenith would take a white token past 1: layer-0 tokens are not
 * tone-mapped, so the rig itself keeps them inside the 8-bit intermediate.
 */
export function perspectiveLight(palette: ScenePalette): PerspectiveLight {
  const { sun, horizonToward, horizonAway } = HDRI_LIGHT;
  const total = legacyIrradiance(palette);
  const sh = bakedSh(HDRI_LIGHT.skySh);
  const up = sh.getIrradianceAt(new Vector3(0, 1, 0), new Vector3());
  const sunUp = sun.irradiance * Math.sin(sun.elevation);
  const [sr, sg, sb] = sun.colour;
  const scale = new Color(
    total / (up.x + sr * sunUp),
    total / (up.y + sg * sunUp),
    total / (up.z + sb * sunUp),
  );
  if (![scale.r, scale.g, scale.b].every((v) => Number.isFinite(v) && v > 0)) {
    throw new Error('HDRI_LIGHT gives no usable light');
  }
  const gain = new Vector3(scale.r, scale.g, scale.b);
  for (const c of sh.coefficients) c.multiply(gain);
  // a uniform radiance below the horizon only reaches band 0 and the y term of band 1
  const bounce = new Color(palette.yard).multiplyScalar(total / Math.PI);
  const bounceVector = new Vector3(bounce.r, bounce.g, bounce.b);
  sh.coefficients[0]?.addScaledVector(bounceVector, SH_Y00 * 2 * Math.PI);
  sh.coefficients[1]?.addScaledVector(bounceVector, -SH_Y10 * Math.PI);
  const sunColor = new Color(...sun.colour).multiply(scale);
  const sunLuminance = 0.2126 * sunColor.r + 0.7152 * sunColor.g + 0.0722 * sunColor.b;
  sunColor.multiplyScalar(1 / sunLuminance);
  const sunIntensity = sun.irradiance * sunLuminance;

  const peak = peakIrradiance(sh, perspectiveSunDirection(), sunColor, sunIntensity);
  const cap = Math.min(1, (PEAK_HEADROOM * Math.PI) / peak);
  scale.multiplyScalar(cap);
  sh.scale(cap);
  return {
    scale,
    sunColor,
    sunIntensity: sunIntensity * cap,
    groundIrradiance: total * cap,
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
  /** Whether the HDRI sun casts; the legacy lights never do. */
  setShadow(on: boolean): void;
  /** Fits the shadow box to `focus` and queues the map for this frame; call before the scene's matrices update. */
  fitShadow(focus: ShadowFocus): void;
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
  const sunDirection = perspectiveSunDirection();
  sun.position.copy(sunDirection).multiplyScalar(SUN_DISTANCE);
  prepareShadow(sun);
  const probe = new LightProbe(light.sh, 1);
  for (const l of [sun, probe]) {
    l.layers.set(PERSPECTIVE_LAYER);
    l.visible = false;
  }

  const object = new Group();
  // in the graph: three never updates the matrix of a target outside it
  object.add(legacySun, legacyAmbient, sun, sun.target, probe);
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
    setShadow(on) {
      sun.castShadow = on;
    },
    fitShadow(focus) {
      if (sun.castShadow) {
        const fit = fitSunShadow(focus, sunDirection, sun.shadow.mapSize.width);
        sun.position.copy(fit.position);
        sun.target.position.copy(fit.target);
        const camera = sun.shadow.camera;
        camera.left = -fit.half;
        camera.right = fit.half;
        camera.bottom = -fit.half;
        camera.top = fit.half;
        camera.near = fit.near;
        camera.far = fit.far;
        camera.updateProjectionMatrix();
      }
      queueShadow(sun);
    },
  };
}
