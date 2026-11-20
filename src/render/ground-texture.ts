import {
  Float32BufferAttribute,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  type Texture,
} from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import groundUrl from './assets/ground.ktx2?url';
import { createGroundMaterial } from './ground-material';
import { buildSerially } from './grade';
import { GROUND_SHADER_MARKER } from './ground-texture-spec';
import { gpuLost } from './seams';
import {
  describeTranscodeTarget,
  startTextureSet,
  type TextureMaps,
  type TextureSet,
} from './texture-set';

/*
 * The authored ground detail map (tools/textures, issue #69), loaded as a one-texture set.
 */

const ANISOTROPY = 8; // three clamps this to what the GPU offers

/** The ground's textures; `detail` is the tiling detail map. */
export type GroundTextures = TextureSet<'detail'>;

/**
 * Builds the ground material for `texture` before any ground wears it, so a node or pipeline error
 * rejects here instead of in a frame; a GLSL error also reaches the shader watch. three swaps a
 * material whose node graph throws for a plain one and only logs it, hence the marker check.
 */
export async function precompileGround(
  renderer: WebGPURenderer,
  { detail: texture }: TextureMaps<'detail'>,
): Promise<void> {
  const geometry = new PlaneGeometry();
  const vertices = geometry.getAttribute('position').count;
  geometry
    .setAttribute('color', new Float32BufferAttribute(new Float32Array(vertices * 3), 3))
    .setAttribute('groundSelect', new Float32BufferAttribute(new Float32Array(vertices * 3), 3));
  const material = createGroundMaterial(texture);
  const mesh = new Mesh(geometry, material);
  const scene = new Scene();
  scene.add(mesh);
  try {
    const { fragmentShader } = await buildSerially(renderer, () =>
      renderer.debug.getShaderAsync(scene, new PerspectiveCamera(), mesh),
    );
    if (fragmentShader?.includes(GROUND_SHADER_MARKER) !== true) {
      throw new Error('the ground shader did not build');
    }
    // a compile on a lost context passes vacuously
    if (gpuLost(renderer)) throw new Error('the GPU context was lost');
  } finally {
    material.dispose();
    geometry.dispose();
  }
}

/**
 * A failed load warns and leaves the token ground. `onApplied` receives the transcode target
 * (`describeTranscodeTarget`) while some subscriber draws the texture, `TEXTURE_FAILED` once the
 * texture is given up on while enabled, and `null` otherwise; the offline e2e reads it.
 */
export function startGroundTextures(
  load?: (renderer: WebGPURenderer) => Promise<Texture>,
  onApplied: (state: string | null) => void = () => undefined,
): GroundTextures {
  return startTextureSet({
    urls: { detail: groundUrl },
    prepare: (_, texture) => {
      texture.wrapS = texture.wrapT = RepeatWrapping;
      texture.anisotropy = ANISOTROPY;
    },
    precompile: precompileGround,
    describe: ({ detail }) => describeTranscodeTarget(detail),
    ...(load === undefined ? {} : { load: async (gl) => ({ detail: await load(gl) }) }),
    onApplied,
    label: 'Ground texture',
    fallback: 'the token ground',
    marker: GROUND_SHADER_MARKER,
  });
}
