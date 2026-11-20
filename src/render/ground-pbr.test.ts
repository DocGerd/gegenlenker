import { DataTexture, type Texture } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { afterEach, describe, expect, it } from 'vitest';
import { GRADE_SHADER_MARKER, setGradeDisabled } from './grade';
import { GROUND_PBR_MARKER } from './ground-pbr-material';
import { precompileGroundPbr } from './ground-pbr';
import { PBR_SAMPLER_BUDGET, type PbrKey } from './ground-pbr-spec';
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

/** A renderer whose build yields `fragment`, on a context that is `lost` or not. */
const building = (fragment: string | null, lost = false): WebGPURenderer =>
  Object.assign(Object.create(WebGPURenderer.prototype) as WebGPURenderer, {
    debug: {
      onShaderError: null,
      getShaderAsync: () => Promise.resolve({ fragmentShader: fragment }),
    },
    getContext: () => ({ isContextLost: () => lost }),
  });

const samplers = (count: number): string =>
  Array.from({ length: count }, (_, i) => `uniform sampler2D nodeUniform${String(i)};`).join('\n');
const built = (count: number, markers: readonly string[]): string =>
  `${samplers(count)}\n${markers.map((m) => `vec3 ${m};`).join('\n')}`;
const both = [GROUND_PBR_MARKER, GRADE_SHADER_MARKER];

describe('PBR ground precompile', () => {
  afterEach(() => {
    setGradeDisabled(false);
  });

  it('passes a graded build that carries both markers within the sampler budget', async () => {
    await expect(
      precompileGroundPbr(building(built(PBR_SAMPLER_BUDGET, both)), maps),
    ).resolves.toBeUndefined();
  });

  it('needs only its own marker while the grade is disabled', async () => {
    setGradeDisabled(true);
    await expect(
      precompileGroundPbr(building(built(1, [GROUND_PBR_MARKER])), maps),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['three swapped in a plain material', building('void main() {}')],
    ['the build has no fragment shader', building(null)],
    ['the PBR marker is missing', building(built(1, [GRADE_SHADER_MARKER]))],
    ['the grade marker is missing', building(built(1, [GROUND_PBR_MARKER]))],
    ['it declares more samplers than the budget', building(built(PBR_SAMPLER_BUDGET + 1, both))],
    ['the context is lost', building(built(1, both), true)],
  ])('rejects when %s', async (_, gl) => {
    await expect(precompileGroundPbr(gl, maps)).rejects.toThrow();
  });
});
