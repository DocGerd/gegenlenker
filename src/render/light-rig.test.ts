import { readFileSync } from 'node:fs';
import {
  Color,
  DirectionalLight,
  HemisphereLight,
  Layers,
  LightProbe,
  type Light,
  SphericalHarmonics3,
  Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';
import { shBasis } from '../../tools/textures/hdri-light';
import type { ScenePalette, ScenePaletteKey } from '../contracts/render';
import {
  createLightRig,
  legacyIrradiance,
  perspectiveLight,
  perspectiveSunDirection,
} from './light-rig';
import { domeGround } from './scene-sky';
import { KEYS } from './palette';
import {
  AIDS_LAYER,
  CAB_LAYER,
  DEFAULT_LAYER,
  enableLayers,
  INTERIOR_LAYER,
  PERSPECTIVE_LAYER,
  TOP_DOWN_LAYERS,
} from './seams';
import { isShadowCamera } from './sun-shadow';

// the scene tokens are theme-independent
const css = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8');
const scene = Object.fromEntries(
  (Object.keys(KEYS) as ScenePaletteKey[]).map((k) => {
    const hex = new RegExp(`--scene-${k}:\\s*#([0-9a-f]{6});`, 'i').exec(css)?.[1];
    if (hex === undefined) throw new Error(`--scene-${k} missing`);
    return [k, parseInt(hex, 16)];
  }),
) as ScenePalette;

/** Irradiance the perspective rig puts on a surface facing `normal`, per channel. */
function irradiance(light: ReturnType<typeof perspectiveLight>, normal: Vector3): Color {
  const sh = light.sh.getIrradianceAt(normal, new Vector3());
  const sun = Math.max(0, normal.dot(perspectiveSunDirection())) * light.sunIntensity;
  return new Color(sh.x, sh.y, sh.z).add(light.sunColor.clone().multiplyScalar(sun));
}

/** Every whole degree of elevation and azimuth, plus the sun itself. */
function normals(): Vector3[] {
  const out = [perspectiveSunDirection()];
  for (let elevation = -90; elevation <= 90; elevation++) {
    for (let azimuth = 0; azimuth < 360; azimuth++) {
      const e = (elevation * Math.PI) / 180;
      const a = (azimuth * Math.PI) / 180;
      out.push(new Vector3(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)));
    }
  }
  return out;
}

it('bakes with the SH basis three evaluates the light probe with', () => {
  const basis: number[] = [];
  for (const d of [new Vector3(1, 2, 3), new Vector3(-0.3, 0.1, 0.9), new Vector3(0, -1, 0)]) {
    d.normalize();
    SphericalHarmonics3.getBasisAt(d, basis);
    shBasis(d.x, d.y, d.z).forEach((b, j) => expect(b).toBeCloseTo(basis[j] ?? NaN, 6));
  }
});

describe('perspective light rig', () => {
  const light = perspectiveLight(scene);

  it('takes no lit surface of any normal past the 8-bit top', () => {
    // layer-0 tokens are not tone-mapped, and a cone's white bands face every way
    let peak = 0;
    for (const n of normals()) {
      const e = irradiance(light, n);
      peak = Math.max(peak, e.r, e.g, e.b);
    }
    expect(peak / Math.PI).toBeLessThanOrEqual(1);
  });

  it('lights the ground neutrally and no brighter than the legacy rig', () => {
    const up = irradiance(light, new Vector3(0, 1, 0));
    expect(up.g / up.r).toBeCloseTo(1, 3);
    expect(up.b / up.r).toBeCloseTo(1, 3);
    expect(up.r).toBeLessThanOrEqual(legacyIrradiance(scene));
    expect(light.groundIrradiance).toBeCloseTo(up.r, 4);
  });

  it('continues the ground below the horizon of the dome with the rig that lights it', () => {
    const verge = new Color(scene.verge);
    const expected = (irradiance: number) => verge.clone().multiplyScalar(irradiance / Math.PI);
    expect(domeGround(scene, true).getHex()).toBe(expected(light.groundIrradiance).getHex());
    expect(domeGround(scene, false).getHex()).toBe(expected(legacyIrradiance(scene)).getHex());
  });
});

describe('light rig', () => {
  const lights = (rig: ReturnType<typeof createLightRig>) => {
    const all = rig.object.children;
    const [legacySun, sun] = all.filter((l) => l instanceof DirectionalLight);
    const ambient = all.find((l) => l instanceof HemisphereLight);
    const probe = all.find((l) => l instanceof LightProbe);
    if (!legacySun || !sun || !ambient || !probe) throw new Error('missing lights');
    return { legacy: [legacySun, ambient], hdri: [sun, probe], sun, probe };
  };
  const only = (layer: number) => (l: Light) => l.layers.mask === 1 << layer;

  it('lights everything with the legacy rig until split', () => {
    const { legacy, hdri } = lights(createLightRig(scene));
    expect(legacy.every(only(DEFAULT_LAYER))).toBe(true);
    expect(hdri.every((l) => only(PERSPECTIVE_LAYER)(l) && !l.visible)).toBe(true);
  });

  it('gives the top-down view the legacy rig and the perspective views the HDRI rig when split', () => {
    const rig = createLightRig(scene);
    const { legacy, hdri } = lights(rig);
    rig.setSplit(true);
    expect(legacy.every(only(AIDS_LAYER))).toBe(true);
    expect(hdri.every((l) => only(PERSPECTIVE_LAYER)(l) && l.visible)).toBe(true);
    rig.setSplit(false);
    expect(legacy.every(only(DEFAULT_LAYER))).toBe(true);
    expect(hdri.every((l) => !l.visible)).toBe(true);
  });

  it('dims the HDRI rig only', () => {
    const rig = createLightRig(scene);
    const { legacy, sun, probe } = lights(rig);
    const before = legacy.map((l) => l.intensity);
    rig.setIntensity(0.25);
    expect(sun.intensity).toBeCloseTo(perspectiveLight(scene).sunIntensity * 0.25, 6);
    expect(probe.intensity).toBe(0.25);
    expect(legacy.map((l) => l.intensity)).toEqual(before);
  });

  describe('sun shadow', () => {
    const sees = (camera: Layers, layer: number): boolean => {
      const object = new Layers();
      object.set(layer);
      return camera.test(object);
    };
    const focus = { x: 40, y: -12, radius: 12 };

    it('draws the caster layers only, once per queued frame', () => {
      const { sun } = lights(createLightRig(scene));
      const { camera } = sun.shadow;
      for (const layer of [DEFAULT_LAYER, PERSPECTIVE_LAYER, CAB_LAYER]) {
        expect(sees(camera.layers, layer), `layer ${layer}`).toBe(true);
      }
      for (const layer of [AIDS_LAYER, INTERIOR_LAYER]) {
        expect(sees(camera.layers, layer), `layer ${layer}`).toBe(false);
      }
      expect(sun.shadow.autoUpdate).toBe(false);
      expect(isShadowCamera(camera)).toBe(true);
    });

    it('queues the map only while the sun casts', () => {
      const rig = createLightRig(scene);
      const { sun } = lights(rig);
      rig.fitShadow(focus);
      expect(sun.shadow.needsUpdate).toBe(false);
      rig.setShadow(true);
      rig.fitShadow(focus);
      expect(sun.shadow.needsUpdate).toBe(true);
      sun.shadow.needsUpdate = false;
      rig.setShadow(false);
      rig.fitShadow(focus);
      expect(sun.shadow.needsUpdate).toBe(false);
    });

    it('keeps the target in the graph so its matrix follows the fit', () => {
      const rig = createLightRig(scene);
      const { sun } = lights(rig);
      expect(sun.target.parent).toBe(rig.object);
      rig.setShadow(true);
      rig.fitShadow(focus);
      rig.object.updateMatrixWorld();
      const aimed = sun.position.clone().sub(sun.target.position).normalize();
      expect(aimed.distanceTo(perspectiveSunDirection())).toBeLessThan(1e-9);
      expect(sun.target.matrixWorld.elements.slice(12, 15)).toEqual(sun.target.position.toArray());
      expect(
        Math.hypot(sun.target.position.x - focus.x, sun.target.position.z + focus.y),
      ).toBeLessThan(1);
    });

    it('never lets a light the top-down camera sees cast', () => {
      const topDown = new Layers();
      topDown.set(DEFAULT_LAYER);
      enableLayers(topDown, TOP_DOWN_LAYERS);
      for (const split of [false, true]) {
        const rig = createLightRig(scene);
        rig.setSplit(split);
        rig.setShadow(true);
        rig.fitShadow(focus);
        const all = rig.object.children.filter((l): l is Light => 'isLight' in l);
        expect(all.length).toBeGreaterThan(0);
        for (const l of all) {
          if (topDown.test(l.layers)) expect(l.castShadow, `split ${split}`).toBe(false);
        }
      }
    });
  });
});
