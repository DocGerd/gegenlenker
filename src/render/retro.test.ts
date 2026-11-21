import { BoxGeometry, type BufferGeometry, SpotLight, Vector3 } from 'three';
import { PhongLightingModel } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { trucks } from '../vehicles/registry';
import { truckAnchors } from '../vehicles/anchors';
import { GRADE_SHADER_MARKER } from './grade';
import { truckLampLights } from './lamp-light';
import { RETRO, RETRO_SHADER_MARKER, RetroNodeMaterial, retroLitSample, retroLobe } from './retro';
import { RETRO_ATTRIBUTE, withRetro } from './tint';

describe('retroLobe', () => {
  it('is full at zero observation angle and falls as the viewer leaves the light', () => {
    expect(retroLobe(0)).toBe(1);
    const lobes = [0.05, 0.1, 0.2, 0.8].map(retroLobe);
    expect([...lobes].sort((a, b) => b - a)).toEqual(lobes);
    expect(lobes[3]).toBeLessThan(0.01);
  });

  it.each(trucks)(
    'still returns light to the driver of $id from sheeting 10 to 40 m ahead of the dipped beam',
    (spec) => {
      const eye = truckAnchors(spec).eye;
      const [front] = truckLampLights(spec);
      if (front === undefined) throw new Error('no front light');
      const lamp = new Vector3(front.position.x, front.position.y, front.position.z);
      const driver = new Vector3(eye.x, eye.y, eye.z);
      for (const ahead of [10, 20, 40]) {
        const target = new Vector3(lamp.x + ahead, 0, 0.6);
        const angle = lamp.clone().sub(target).angleTo(driver.clone().sub(target));
        expect(retroLobe(angle) * RETRO.gain, `${ahead} m`).toBeGreaterThan(0.5);
      }
    },
  );
});

describe('withRetro', () => {
  it('gives every vertex the same value, 0 by default', () => {
    const values = (g: BufferGeometry): number[] =>
      Array.from(g.getAttribute(RETRO_ATTRIBUTE).array);
    const count = new BoxGeometry().getAttribute('position').count;
    expect(values(withRetro(new BoxGeometry(), 1))).toEqual(Array<number>(count).fill(1));
    expect(values(withRetro(new BoxGeometry())).every((v) => v === 0)).toBe(true);
  });
});

describe('the reflector material', () => {
  it('adds its term in the lighting model, over the plain Lambert one', () => {
    const model = new RetroNodeMaterial().setupLightingModel();
    expect(model).toBeInstanceOf(PhongLightingModel);
    expect(Object.hasOwn(Object.getPrototypeOf(model) as object, 'direct')).toBe(true);
  });

  it('has a shader check sample: graded retro surface under a spot light, named by both markers', () => {
    const sample = retroLitSample();
    expect(sample.mesh.material).toBeInstanceOf(RetroNodeMaterial);
    expect(sample.mesh.geometry.hasAttribute(RETRO_ATTRIBUTE)).toBe(true);
    expect(sample.lights?.every((l) => l instanceof SpotLight)).toBe(true);
    expect(sample.markers).toEqual([RETRO_SHADER_MARKER, GRADE_SHADER_MARKER]);
    sample.dispose();
  });
});
