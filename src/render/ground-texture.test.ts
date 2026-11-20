import { DataTexture, type Texture } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { precompileGround } from './ground-texture';
import { GROUND_SHADER_MARKER } from './ground-texture-spec';

const renderer = (): WebGPURenderer =>
  Object.assign(Object.create(WebGPURenderer.prototype) as WebGPURenderer, {
    debug: { onShaderError: null },
  });
const texture = (): Texture => new DataTexture(new Uint8Array(4), 1, 1);

/** A renderer whose ground build yields `fragment`, on a context that is `lost` or not. */
const building = (fragment: string | null, lost = false): WebGPURenderer =>
  Object.assign(renderer(), {
    debug: {
      onShaderError: null,
      getShaderAsync: () => Promise.resolve({ fragmentShader: fragment }),
    },
    getContext: () => ({ isContextLost: () => lost }),
  });
const marked = `vec3 ${GROUND_SHADER_MARKER};`;

describe('ground precompile', () => {
  it('passes a build that carries the marker', async () => {
    await expect(
      precompileGround(building(marked), { detail: texture() }),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['three swapped in a plain material', building('void main() {}')],
    ['the context is lost', building(marked, true)],
  ])('rejects when %s', async (_, gl) => {
    await expect(precompileGround(gl, { detail: texture() })).rejects.toThrow();
  });
});
