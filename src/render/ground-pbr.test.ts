import { DataTexture, DirectionalLight, LightProbe, SpotLight, type Texture } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { afterEach, describe, expect, it } from 'vitest';
import { GRADE_SHADER_MARKER, setGradeDisabled } from './grade';
import { GROUND_PBR_MARKER } from './ground-pbr-material';
import { pbrGroundNightSample, precompileGroundPbr } from './ground-pbr';
import { MARKING_WEAR_MARKER } from './marking-wear';
import {
  PBR_SAMPLER_BUDGET,
  type PbrKey,
  SAMPLER_CEILING,
  SHADOW_SAMPLERS,
} from './ground-pbr-spec';
import type { TextureMaps } from './texture-set';

const texture = (): Texture => new DataTexture(new Uint8Array(4), 1, 1);
const maps: TextureMaps<PbrKey> = {
  concreteAlbedo: texture(),
  concretePacked: texture(),
  asphaltAlbedo: texture(),
  asphaltPacked: texture(),
  paversAlbedo: texture(),
  paversPacked: texture(),
};

/**
 * A renderer whose ground build yields `fragment` (`shadowed` under the sun shadow), and whose worn
 * marking build yields `worn`, on a context that is `lost` or not.
 */
const building = (
  fragment: string | null,
  lost = false,
  shadowed = fragment,
  worn: string | null = wornBuild(),
): WebGPURenderer => {
  const builds = [fragment, worn, shadowed, worn];
  return Object.assign(Object.create(WebGPURenderer.prototype) as WebGPURenderer, {
    debug: {
      onShaderError: null,
      getShaderAsync: () => Promise.resolve({ fragmentShader: builds.shift() ?? null }),
    },
    getContext: () => ({ isContextLost: () => lost }),
  });
};

const samplers = (count: number): string =>
  Array.from({ length: count }, (_, i) => `uniform sampler2D nodeUniform${String(i)};`).join('\n');
const built = (count: number, markers: readonly string[]): string =>
  `${samplers(count)}\n${markers.map((m) => `vec3 ${m};`).join('\n')}`;
const both = [GROUND_PBR_MARKER, GRADE_SHADER_MARKER];
function wornBuild(
  markers: readonly string[] = [MARKING_WEAR_MARKER, GRADE_SHADER_MARKER],
): string {
  return markers.map((m) => `vec3 ${m};`).join('\n');
}

describe('PBR ground precompile', () => {
  afterEach(() => {
    setGradeDisabled(false);
  });

  it('passes a graded build that carries both markers within the sampler budget', async () => {
    await expect(
      precompileGroundPbr(building(built(PBR_SAMPLER_BUDGET, both)), maps),
    ).resolves.toBeUndefined();
  });

  it('lets the sun shadow add its sampler', async () => {
    await expect(
      precompileGroundPbr(
        building(
          built(PBR_SAMPLER_BUDGET, both),
          false,
          built(PBR_SAMPLER_BUDGET + SHADOW_SAMPLERS, both),
        ),
        maps,
      ),
    ).resolves.toBeUndefined();
  });

  it('needs only its own marker while the grade is disabled', async () => {
    setGradeDisabled(true);
    await expect(
      precompileGroundPbr(
        building(built(1, [GROUND_PBR_MARKER]), false, undefined, wornBuild([MARKING_WEAR_MARKER])),
        maps,
      ),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['three swapped in a plain material', building('void main() {}')],
    ['the build has no fragment shader', building(null)],
    ['the PBR marker is missing', building(built(1, [GRADE_SHADER_MARKER]))],
    ['the grade marker is missing', building(built(1, [GROUND_PBR_MARKER]))],
    ['it declares more samplers than the budget', building(built(PBR_SAMPLER_BUDGET + 1, both))],
    [
      'the shadow-receiving build goes over the budget',
      building(
        built(PBR_SAMPLER_BUDGET, both),
        false,
        built(PBR_SAMPLER_BUDGET + SHADOW_SAMPLERS + 1, both),
      ),
    ],
    [
      'the worn marking marker is missing',
      building(built(1, both), false, undefined, wornBuild([GRADE_SHADER_MARKER])),
    ],
    [
      'the worn marking grade marker is missing',
      building(built(1, both), false, undefined, wornBuild([MARKING_WEAR_MARKER])),
    ],
    [
      'the worn marking build has no fragment shader',
      building(built(1, both), false, undefined, null),
    ],
    ['the context is lost', building(built(1, both), true)],
  ])('rejects when %s', async (_, gl) => {
    await expect(precompileGroundPbr(gl, maps)).rejects.toThrow();
  });
});

describe('the PBR ground at night', () => {
  it('is checked under the whole High light set, within the sampler ceiling', () => {
    const sample = pbrGroundNightSample();
    const lights = sample.lights ?? [];
    expect(lights.filter((l) => l instanceof DirectionalLight).map((l) => l.castShadow)).toEqual([
      false,
    ]);
    expect(lights.filter((l) => l instanceof LightProbe)).toHaveLength(1);
    const spots = lights.filter((l): l is SpotLight => l instanceof SpotLight);
    expect(spots).toHaveLength(3);
    const mapped = spots.filter((l) => l.map !== null);
    const casting = spots.filter((l) => l.castShadow);
    // a map and a shadow each add a sampler to every receiver
    expect(mapped).toHaveLength(2);
    expect(casting).toHaveLength(2);
    expect(PBR_SAMPLER_BUDGET + mapped.length + casting.length).toBeLessThanOrEqual(
      SAMPLER_CEILING,
    );
    expect(sample.maxSamplers).toBe(SAMPLER_CEILING);
    expect(sample.mesh.receiveShadow).toBe(true);
    expect(sample.markers).toEqual([GROUND_PBR_MARKER, GRADE_SHADER_MARKER]);
    sample.dispose();
  });
});
