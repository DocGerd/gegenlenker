import { Color, PerspectiveCamera, RepeatWrapping, Scene, Vector3, type Texture } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import skyUrl from './assets/sky.ktx2?url';
import { startTextureSet, type TextureMaps, type TextureSet } from './texture-set';
import { buildSerially } from './grade';
import { gpuLost } from './seams';
import { createSky, SKY_SHADER_MARKER } from './sky';

/*
 * The HDRI sky (docs/asset-credits.md): the upper hemisphere, sun clamped, stored as x / (1 + x)
 * in sRGB. Not precached; the service worker caches it at runtime on first use (src/pwa/config.ts).
 */

/** Builds an HDRI sky dome before any sky wears `map`, so a node or GLSL error rejects here. */
export async function precompileSky(
  renderer: WebGPURenderer,
  { sky: map }: TextureMaps<'sky'>,
): Promise<void> {
  const black = new Color(0);
  const sky = createSky(black, black, black, black, new Vector3(0, 1, 0));
  sky.setHdri(map);
  sky.mesh.layers.set(0);
  const scene = new Scene();
  scene.add(sky.mesh);
  try {
    const { fragmentShader } = await buildSerially(renderer, () =>
      renderer.debug.getShaderAsync(scene, new PerspectiveCamera(), sky.mesh),
    );
    if (fragmentShader?.includes(SKY_SHADER_MARKER) !== true) {
      throw new Error('the sky shader did not build');
    }
    if (gpuLost(renderer)) throw new Error('the GPU context was lost');
  } finally {
    sky.dispose();
  }
}

/** The sky's textures; `sky` is the HDRI map. */
export type SkyTextures = TextureSet<'sky'>;

/** `onApplied` receives `on` while some sky draws the texture, `failed` once given up on, else null; the e2e reads it. */
export function startSkyTexture(
  load?: (renderer: WebGPURenderer) => Promise<Texture>,
  onApplied: (state: string | null) => void = () => undefined,
): SkyTextures {
  return startTextureSet({
    urls: { sky: skyUrl },
    prepare: (_, texture) => {
      texture.wrapS = RepeatWrapping;
    },
    precompile: precompileSky,
    describe: () => 'on',
    ...(load === undefined ? {} : { load: async (gl) => ({ sky: await load(gl) }) }),
    onApplied,
    label: 'Sky texture',
    fallback: 'the analytic sky',
    marker: SKY_SHADER_MARKER,
  });
}
