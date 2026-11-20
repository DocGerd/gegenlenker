import {
  DataTexture,
  DirectionalLight,
  Float32BufferAttribute,
  LightProbe,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  type Texture,
} from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import asphaltAlbedoUrl from './assets/asphalt-albedo.ktx2?url';
import asphaltPackedUrl from './assets/asphalt-packed.ktx2?url';
import concreteAlbedoUrl from './assets/concrete-albedo.ktx2?url';
import concretePackedUrl from './assets/concrete-packed.ktx2?url';
import paversAlbedoUrl from './assets/pavers-albedo.ktx2?url';
import paversPackedUrl from './assets/pavers-packed.ktx2?url';
import { buildSerially, GRADE_SHADER_MARKER, gradeDisabled, setGraded } from './grade';
import { createGroundPbrMaterial, GROUND_PBR_MARKER } from './ground-pbr-material';
import { PBR_SAMPLER_BUDGET, type PbrKey } from './ground-pbr-spec';
import { COCKPIT_LAYERS, enableLayers, gpuLost, PERSPECTIVE_LAYER } from './seams';
import {
  describeTranscodeTarget,
  startTextureSet,
  type TextureMaps,
  type TextureSet,
} from './texture-set';

/*
 * The authored PBR ground maps (tools/textures/pbr-build.ts), loaded as one six-texture set beside
 * the detail ground, which stays the fallback.
 */

const ANISOTROPY = 8; // three clamps this to what the GPU offers

/** The PBR ground's textures: an albedo detail and a packed normal, roughness and occlusion map per surface. */
export type GroundPbrTextures = TextureSet<PbrKey>;

/** Texture declarations in a fragment shader, GLSL or WGSL. */
export function countSamplers(fragment: string): number {
  const glsl = fragment.match(/\buniform\s+(?:\w+\s+)?sampler\w+\s+\w+/g)?.length ?? 0;
  const wgsl = fragment.match(/\bvar\s+\w+\s*:\s*texture_\w+</g)?.length ?? 0;
  return glsl + wgsl;
}

/**
 * Builds the PBR ground material for `maps` before any ground wears it, under the perspective
 * light rig and grade, so a node, pipeline or sampler-count error rejects here instead of in a
 * frame. A stand-in replaces the detail map, which loads separately. three swaps a material whose
 * node graph throws for a plain one and only logs it, hence the marker check.
 */
export async function precompileGroundPbr(
  renderer: WebGPURenderer,
  maps: TextureMaps<PbrKey>,
): Promise<void> {
  const geometry = new PlaneGeometry();
  const vertices = geometry.getAttribute('position').count;
  geometry
    .setAttribute('color', new Float32BufferAttribute(new Float32Array(vertices * 3), 3))
    .setAttribute('groundSelect', new Float32BufferAttribute(new Float32Array(vertices * 3), 3));
  const macro = new DataTexture(new Uint8Array(4), 1, 1);
  macro.needsUpdate = true;
  const material = createGroundPbrMaterial(maps, macro, { x: 0, y: 0 });
  const graded = !gradeDisabled();
  setGraded(material, graded);
  const mesh = new Mesh(geometry, material);
  // the lights the perspective views draw it under: the HDRI sun and sky
  const scene = new Scene();
  const lights = [new DirectionalLight(), new LightProbe()];
  for (const light of lights) light.layers.set(PERSPECTIVE_LAYER);
  scene.add(mesh, ...lights);
  const camera = new PerspectiveCamera();
  enableLayers(camera.layers, COCKPIT_LAYERS);
  try {
    const { fragmentShader } = await buildSerially(renderer, () =>
      renderer.debug.getShaderAsync(scene, camera, mesh),
    );
    const markers = graded ? [GROUND_PBR_MARKER, GRADE_SHADER_MARKER] : [GROUND_PBR_MARKER];
    if (!markers.every((marker) => fragmentShader?.includes(marker) === true)) {
      throw new Error('the PBR ground shader did not build');
    }
    const samplers = countSamplers(fragmentShader ?? '');
    if (samplers > PBR_SAMPLER_BUDGET) {
      throw new Error(`the PBR ground shader declares ${samplers} samplers`);
    }
    // a compile on a lost context passes vacuously
    if (gpuLost(renderer)) throw new Error('the GPU context was lost');
  } finally {
    material.dispose();
    geometry.dispose();
    macro.dispose();
  }
}

/**
 * A failed load warns and leaves the detail ground. `onApplied` receives the transcode target
 * (`describeTranscodeTarget`) while some subscriber draws the set, `TEXTURE_FAILED` once it is given
 * up on while enabled, and `null` otherwise; the offline e2e reads it.
 */
export function startGroundPbrTextures(
  load?: (renderer: WebGPURenderer) => Promise<TextureMaps<PbrKey>>,
  onApplied: (state: string | null) => void = () => undefined,
): GroundPbrTextures {
  return startTextureSet({
    urls: {
      concreteAlbedo: concreteAlbedoUrl,
      concretePacked: concretePackedUrl,
      asphaltAlbedo: asphaltAlbedoUrl,
      asphaltPacked: asphaltPackedUrl,
      paversAlbedo: paversAlbedoUrl,
      paversPacked: paversPackedUrl,
    },
    prepare: (_, texture: Texture) => {
      texture.wrapS = texture.wrapT = RepeatWrapping;
      texture.anisotropy = ANISOTROPY;
    },
    precompile: precompileGroundPbr,
    describe: ({ concretePacked }) => describeTranscodeTarget(concretePacked),
    ...(load === undefined ? {} : { load }),
    onApplied,
    label: 'PBR ground',
    fallback: 'the detail ground',
    marker: GROUND_PBR_MARKER,
  });
}
