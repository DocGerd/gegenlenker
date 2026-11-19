import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Color, SphericalHarmonics3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { bakeHdriLight, shBasis, SUN_AZIMUTH } from '../../tools/textures/hdri-light';
import type { ScenePalette, ScenePaletteKey } from '../contracts/render';
import { HDRI_LIGHT } from './hdri-light';
import { legacyIrradiance, perspectiveLight, perspectiveSunDirection } from './light-rig';
import { KEYS } from './palette';

// the scene tokens are theme-independent
const css = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8');
const scene = Object.fromEntries(
  (Object.keys(KEYS) as ScenePaletteKey[]).map((k) => {
    const hex = new RegExp(`--scene-${k}:\\s*#([0-9a-f]{6});`, 'i').exec(css)?.[1];
    if (hex === undefined) throw new Error(`--scene-${k} missing`);
    return [k, parseInt(hex, 16)];
  }),
) as ScenePalette;

const luminance = (c: Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/** Irradiance the perspective rig puts on a surface facing `normal`. */
function irradianceRgb(light: ReturnType<typeof perspectiveLight>, normal: Vector3): Color {
  const sh = light.sh.getIrradianceAt(normal, new Vector3());
  const sun = Math.max(0, normal.dot(perspectiveSunDirection())) * light.sunIntensity;
  return new Color(sh.x, sh.y, sh.z).add(light.sunColor.clone().multiplyScalar(sun));
}
const irradiance = (light: ReturnType<typeof perspectiveLight>, normal: Vector3): number =>
  luminance(irradianceRgb(light, normal));

describe('HDRI bake', () => {
  it('uses the SH basis three evaluates the light probe with', () => {
    const basis: number[] = [];
    for (const d of [new Vector3(1, 2, 3), new Vector3(-0.3, 0.1, 0.9), new Vector3(0, -1, 0)]) {
      d.normalize();
      SphericalHarmonics3.getBasisAt(d, basis);
      shBasis(d.x, d.y, d.z).forEach((b, j) => expect(b).toBeCloseTo(basis[j] ?? NaN, 6));
    }
  });

  it('finds a point sun and turns the sky so it stands at the given azimuth', () => {
    const width = 128;
    const height = 64;
    const rgb = new Float32Array(width * height * 3).fill(0.5);
    const sun = { x: 80, y: 10 }; // row 0 is the zenith
    rgb.fill(1000, (sun.y * width + sun.x) * 3, (sun.y * width + sun.x) * 3 + 3);
    const baked = bakeHdriLight({ width, height, rgb });
    expect(baked.sun.elevation).toBeCloseTo(Math.PI / 2 - ((sun.y + 0.5) / height) * Math.PI, 5);
    expect(baked.sun.u).toBeCloseTo((sun.x + 0.5) / width, 5);
    expect(baked.azimuth).toBeCloseTo(SUN_AZIMUTH, 5);
    // the clamped sky is a constant 0.5 over the upper hemisphere: E = π L on an upward surface
    expect(baked.skyIrradiance).toBeCloseTo(0.5 * Math.PI, 1);
  });

  it('was baked from the sky texture that ships', () => {
    const ktx2 = readFileSync(new URL('./assets/sky.ktx2', import.meta.url));
    expect(createHash('sha256').update(ktx2).digest('hex')).toBe(HDRI_LIGHT.skyKtx2Sha256);
  });
});

describe('perspective light rig', () => {
  const light = perspectiveLight(scene);

  it('lights the ground as bright and as neutral as the legacy rig does', () => {
    const up = irradianceRgb(light, new Vector3(0, 1, 0));
    const legacy = legacyIrradiance(scene);
    for (const channel of [up.r, up.g, up.b]) expect(channel / legacy).toBeCloseTo(1, 2);
  });

  it('keeps every lit token on the ground and walls inside the 8-bit intermediate', () => {
    // layer-0 tokens are not tone-mapped, so the rig itself must keep them below 1
    const sun = perspectiveSunDirection();
    const wall = new Vector3(sun.x, 0, sun.z).normalize();
    const brightest = Math.max(irradiance(light, new Vector3(0, 1, 0)), irradiance(light, wall));
    const unlit = new Set<ScenePaletteKey>(['sky', 'backdrop', 'marking', 'accent', 'tracks']);
    for (const key of Object.keys(KEYS) as ScenePaletteKey[]) {
      if (unlit.has(key)) continue;
      const albedo = new Color(scene[key]);
      const peak = Math.max(albedo.r, albedo.g, albedo.b);
      expect((peak * brightest) / Math.PI, key).toBeLessThanOrEqual(1);
    }
  });
});
