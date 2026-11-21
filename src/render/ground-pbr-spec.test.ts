import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GROUND_SURFACES } from './ground-texture-spec';
import { PBR_PACKED } from './ground-pbr-pixels';
import {
  countSamplers,
  GROUND_FRAME,
  type Mat2,
  SLAB_PITCH,
  SLAB_UV_TRANSFORMS,
  slabNormalMatrix,
} from './ground-pbr-spec';

const apply = ([a, b, c, d]: Mat2, [x, y]: readonly [number, number]): [number, number] => [
  a * x + b * y,
  c * x + d * y,
];

/** A smooth height field in the texture's (right, down) coordinates. */
const height = (u: number, v: number): number => Math.sin(1.3 * u + 0.4) * Math.cos(0.9 * v - 0.2);
const slopeU = (u: number, v: number): number =>
  1.3 * Math.cos(1.3 * u + 0.4) * Math.cos(0.9 * v - 0.2);
const slopeV = (u: number, v: number): number =>
  -0.9 * Math.sin(1.3 * u + 0.4) * Math.sin(0.9 * v - 0.2);

describe('slab transforms', () => {
  it('are the eight distinct rotations and mirrored rotations of a square', () => {
    expect(SLAB_UV_TRANSFORMS).toHaveLength(8);
    expect(new Set(SLAB_UV_TRANSFORMS.map((m) => m.join(','))).size).toBe(8);
    for (const [a, b, c, d] of SLAB_UV_TRANSFORMS) {
      expect(Math.abs(a * d - b * c)).toBe(1);
      // orthogonal rows: a quarter turn or a mirror, never a shear or a scale
      expect(a * c + b * d + 0).toBe(0);
      expect(a * a + b * b).toBe(1);
    }
    expect(SLAB_UV_TRANSFORMS.filter(([a, b, c, d]) => a * d - b * c > 0)).toHaveLength(4);
  });

  it('turn the normal with the texture: a slab draws the height field its normal map describes', () => {
    // The map is the height field's slope in texture space (GL: X right, Y up the image, so the
    // image-up slope is minus the slope along v). A slab wears the field at M * p; the world
    // normal (X along +x, Y along image-up = -z) must be the slope of that worn field.
    const step = 1e-5;
    for (const m of SLAB_UV_TRANSFORMS) {
      const worn = (x: number, z: number): number => height(...apply(m, [x, z]));
      for (const [x, z] of [
        [0.3, -0.7],
        [1.9, 2.4],
      ] as const) {
        const [u, v] = apply(m, [x, z]);
        const texture: readonly [number, number] = [-slopeU(u, v), slopeV(u, v)];
        const [nx, ny] = apply(slabNormalMatrix(m), texture);
        const slopeX = (worn(x + step, z) - worn(x - step, z)) / (2 * step);
        const slopeZ = (worn(x, z + step) - worn(x, z - step)) / (2 * step);
        expect(nx).toBeCloseTo(-slopeX, 6);
        expect(ny).toBeCloseTo(slopeZ, 6);
      }
    }
  });
});

describe('slab pitch', () => {
  it('is the concrete tile over the slab count baked into ground.ktx2, so the joints stay in phase', () => {
    const source = readFileSync(
      join(import.meta.dirname, '../../tools/textures/ground-texture.ts'),
      'utf8',
    );
    const slabs = Number(/const slabs = (\d+);/.exec(source)?.[1]);
    expect(slabs).toBeGreaterThan(0);
    expect(SLAB_PITCH).toBe(GROUND_SURFACES.concrete.tile / slabs);
  });
});

describe('ground frame', () => {
  it('is right-handed, so no normal map is mirrored', () => {
    const [r, u, n] = [GROUND_FRAME.right, GROUND_FRAME.up, GROUND_FRAME.normal];
    const cross = [r[1] * u[2] - r[2] * u[1], r[2] * u[0] - r[0] * u[2], r[0] * u[1] - r[1] * u[0]];
    expect(cross.map((v) => v + 0)).toEqual([...n]);
  });

  it('has image-up opposite the direction v grows, which is +z: row 0 is the top', () => {
    expect(GROUND_FRAME.up).toEqual([0, 0, -1]);
  });

  it('names the packed channels the shader reads', () => {
    expect(Object.values(PBR_PACKED).sort()).toEqual([0, 1, 2, 3]);
  });
});

describe('countSamplers', () => {
  it('counts GLSL texture uniforms and WGSL texture bindings, not the sampler objects', () => {
    const glsl = [
      'uniform sampler2D nodeUniform0;',
      'uniform highp sampler2D nodeUniform1;',
      'uniform vec3 nodeUniform2;',
    ].join('\n');
    const wgsl = [
      '@binding( 1 ) @group( 1 ) var nodeUniform0 : texture_2d<f32>;',
      '@binding( 2 ) @group( 1 ) var nodeUniform0_sampler : sampler;',
      '@binding( 3 ) @group( 1 ) var shadowMap : texture_depth_2d;',
      '@binding( 4 ) @group( 1 ) var shadowMapMs : texture_depth_multisampled_2d;',
      '@binding( 5 ) @group( 1 ) var shadowCompare : sampler_comparison;',
    ].join('\n');
    expect(countSamplers(glsl)).toBe(2);
    expect(countSamplers(wgsl)).toBe(3);
  });
});
