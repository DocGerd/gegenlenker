import { BoxGeometry, type BufferGeometry, Color, SpotLight, Vector3 } from 'three';
import { PhongLightingModel, type WebGPURenderer } from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { trucks } from '../vehicles/registry';
import { truckAnchors } from '../vehicles/anchors';
import { GRADE_SHADER_MARKER, toneMapRgb } from './grade';
import {
  beamPattern,
  candela,
  coneShare,
  facingIrradiance,
  type LampLightSpec,
  truckLampLights,
} from './lamp-light';
import { REALISM_HUES } from './realism-hues';
import {
  RETRO,
  RETRO_SHADER_MARKER,
  RetroNodeMaterial,
  retroBoost,
  createRetroCheck,
  type RetroVerdict,
  retroLitSample,
  retroLobe,
} from './retro';
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

/** The dipped beam's light on a point (the part's frame), as three's spot light gives it: candela, cone, beam map and the inverse square. */
function beamAt(spec: LampLightSpec, point: Vector3): number {
  const position = new Vector3(spec.position.x, spec.position.y, spec.position.z);
  const axis = new Vector3(spec.aim.x, spec.aim.y, spec.aim.z);
  const right = new Vector3().crossVectors(axis, new Vector3(0, 0, 1)).normalize();
  const up = new Vector3().crossVectors(right, axis).normalize();
  const ray = point.clone().sub(position);
  const distance = ray.length();
  ray.normalize();
  const along = ray.dot(axis);
  const reach = Math.tan(spec.angle);
  const u = (ray.dot(right) / along / reach + 1) / 2;
  const v = (ray.dot(up) / along / reach + 1) / 2;
  return (
    candela(spec).white *
    coneShare(spec, along) *
    beamPattern(u, v) *
    facingIrradiance(1, distance, spec.distance)
  );
}

describe('the retro add on lit sheeting', () => {
  const [spec] = trucks;
  if (spec === undefined) throw new Error('no truck');
  const [front] = truckLampLights(spec);
  if (front === undefined) throw new Error('no front light');
  const lamp = new Vector3(front.position.x, front.position.y, front.position.z);
  const eye = truckAnchors(spec).eye;
  const driver = new Vector3(eye.x, eye.y, eye.z);
  const red = new Color(REALISM_HUES.tailLamp);
  const albedo = [red.r, red.g, red.b] as const;

  /** Linear colour of a band of `albedo` facing the lamp at `ahead` metres and `right` metres to the right of the lamp. */
  const band = (ahead: number, right: number) => {
    const point = new Vector3(lamp.x + ahead, lamp.y - right, 0.6);
    const lit = beamAt(front, point);
    const angle = lamp.clone().sub(point).angleTo(driver.clone().sub(point));
    const retro = retroBoost(lit, 1, angle);
    const diffuse = lit / Math.PI;
    return {
      lit,
      retro,
      diffuse,
      linear: albedo.map((a) => a * (diffuse + retro)) as [number, number, number],
    };
  };

  it('is bounded, in units of the sheeting colour', () => {
    for (const lit of [0, 0.01, 1, 100, 1e6]) {
      const boost = retroBoost(lit, 1, 0);
      expect(boost).toBeGreaterThanOrEqual(0);
      expect(boost).toBeLessThanOrEqual(RETRO.max);
    }
    expect(retroBoost(1e-4, 1, 0)).toBeCloseTo(1e-4 * RETRO.gain, 6);
  });

  it('never adds more than the sheeting colour itself, at any distance in the beam', () => {
    for (let ahead = 4; ahead <= 40; ahead += 2) {
      const { diffuse, retro, linear } = band(ahead, 1);
      expect(retro).toBeLessThanOrEqual(RETRO.max);
      linear.forEach((c, i) => {
        expect(c - (albedo[i] ?? 0) * diffuse, `${ahead} m`).toBeLessThanOrEqual(
          (albedo[i] ?? 0) * RETRO.max + 1e-12,
        );
      });
    }
  });

  it.each([
    [20, 2],
    [30, 4],
  ])('keeps a red band %i m ahead and %i m aside red, on every channel curve', (ahead, right) => {
    const { linear } = band(ahead, right);
    // the add scales the band's own colour, so the hue is the albedo's before any clipping
    for (const c of [1, 2] as const) {
      expect(linear[c] / linear[0]).toBeCloseTo(albedo[c] / albedo[0], 9);
    }
    // Balanced: no tone map, so the output clips; only the dominant channel may saturate
    const clipped = linear.map((c) => Math.min(1, c));
    expect(clipped[1]).toBeLessThan(0.2);
    expect(clipped[2]).toBeLessThan(0.2);
    // High: PBR Neutral
    const [r, g, b] = toneMapRgb(linear, 1);
    expect(r).toBeGreaterThan(0.6);
    expect(g).toBeLessThan(0.3);
    expect(b).toBeLessThan(0.3);
  });
});

describe('the reflector shader check', () => {
  const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));
  const gpu = (fragment: string | null): WebGPURenderer =>
    ({
      backend: { isWebGPUBackend: true },
      debug: {
        onShaderError: null,
        getShaderAsync: () => Promise.resolve({ fragmentShader: fragment }),
      },
    }) as unknown as WebGPURenderer;

  it('builds the ungraded program on the live renderer, whatever the preset, and passes when it carries the marker', async () => {
    const check = createRetroCheck();
    const seen: RetroVerdict[] = [];
    check.onChange(() => seen.push(check.verdict()));
    check.attach(gpu(`float ${RETRO_SHADER_MARKER} = 1.0;`));
    expect(check.verdict()).toBe('pending');
    await flush();
    expect(check.verdict()).toBe('ok');
    expect(seen).toEqual(['ok']);
  });

  it('fails where three fell back to a plain material, so the shader lacks the marker', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const check = createRetroCheck();
    check.attach(gpu('void main() {}'));
    check.verdict();
    await flush();
    expect(check.verdict()).toBe('failed');
  });

  it('starts the build once per renderer and judges a new renderer afresh', async () => {
    const compiles = vi.fn(() => Promise.resolve());
    const check = createRetroCheck(compiles);
    check.attach(gpu(null));
    check.verdict();
    check.verdict();
    await flush();
    expect(compiles).toHaveBeenCalledOnce();
    check.attach(gpu(null));
    expect(check.verdict()).toBe('pending');
    expect(compiles).toHaveBeenCalledTimes(2);
  });
});
