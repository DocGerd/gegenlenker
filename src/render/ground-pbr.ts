import {
  DataTexture,
  DirectionalLight,
  Float32BufferAttribute,
  LightProbe,
  LinearFilter,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  RepeatWrapping,
  RGFormat,
  Scene,
  SpotLight,
  type Texture,
  UnsignedByteType,
} from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import asphaltAlbedoUrl from './assets/asphalt-albedo.ktx2?url';
import asphaltPackedUrl from './assets/asphalt-packed.ktx2?url';
import concreteAlbedoUrl from './assets/concrete-albedo.ktx2?url';
import concretePackedUrl from './assets/concrete-packed.ktx2?url';
import paversAlbedoUrl from './assets/pavers-albedo.ktx2?url';
import paversPackedUrl from './assets/pavers-packed.ktx2?url';
import {
  GRADE_SHADER_MARKER,
  gradeDisabled,
  type GradeSample,
  setGraded,
} from './grade';
import { sampleLampLights } from './lamp-light';
import { createGroundPbrMaterial, GROUND_PBR_MARKER } from './ground-pbr-material';
import {
  PBR_SAMPLER_BUDGET,
  type PbrKey,
  SAMPLER_CEILING,
  SHADOW_SAMPLERS,
} from './ground-pbr-spec';
import { createWornMarkingMaterial, MARK_BOX, MARKING_WEAR_MARKER } from './marking-wear';
import { COCKPIT_LAYERS, enableLayers, gpuLost, PERSPECTIVE_LAYER } from './seams';
import { verifyShader } from './shader-check';
import { prepareShadow } from './sun-shadow';
import { FLOOD_SHADOW } from './yard-lights';
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

/**
 * Builds the PBR ground material for `maps` before any ground wears it, under the perspective
 * light rig and grade, lit by the sun with and without its shadow, so a node, pipeline or
 * sampler-count error rejects here instead of in a frame. Stand-ins replace the detail and mask
 * maps, which load or build separately. The worn marking material that rides on the PBR ground builds
 * beside it, so a failure of either leaves the detail ground and the unworn markings. three swaps a
 * material whose node graph throws for a plain one and only logs it, hence the marker check.
 */
export async function precompileGroundPbr(
  renderer: WebGPURenderer,
  maps: TextureMaps<PbrKey>,
): Promise<void> {
  const standIn = groundStandIn(maps);
  const { geometry, material } = standIn;
  const graded = !gradeDisabled();
  setGraded(material, graded);
  const mesh = new Mesh(geometry, material);
  mesh.receiveShadow = true;
  const wornMaterial = createWornMarkingMaterial();
  setGraded(wornMaterial, graded);
  const wornMesh = new Mesh(geometry, wornMaterial);
  wornMesh.receiveShadow = true;
  const gradeMarkers = graded ? [GRADE_SHADER_MARKER] : [];
  try {
    for (const shadow of [false, true]) {
      // the lights the perspective views draw it under: the HDRI sun and sky
      const scene = new Scene();
      const sun = new DirectionalLight();
      sun.castShadow = shadow;
      if (shadow) prepareShadow(sun);
      const lights = [sun, new LightProbe()];
      for (const light of lights) light.layers.set(PERSPECTIVE_LAYER);
      scene.add(mesh, wornMesh, ...lights, sun.target);
      const camera = new PerspectiveCamera();
      enableLayers(camera.layers, COCKPIT_LAYERS);
      const built = (target: Mesh, marker: string, maxSamplers?: number): Promise<string> =>
        verifyShader(renderer, scene, camera, target, {
          subject: `the ${marker} shader`,
          markers: [marker, ...gradeMarkers],
          ...(maxSamplers === undefined ? {} : { maxSamplers }),
        });
      await built(mesh, GROUND_PBR_MARKER, PBR_SAMPLER_BUDGET + (shadow ? SHADOW_SAMPLERS : 0));
      await built(wornMesh, MARKING_WEAR_MARKER);
    }
    // a compile on a lost context passes vacuously
    if (gpuLost(renderer)) throw new Error('the GPU context was lost');
  } finally {
    material.dispose();
    wornMaterial.dispose();
    standIn.dispose();
  }
}

/** The PBR ground on 1x1 stand-in maps, with the vertex attributes it reads. */
function groundStandIn(maps: TextureMaps<PbrKey>) {
  const geometry = new PlaneGeometry();
  const vertices = geometry.getAttribute('position').count;
  geometry
    .setAttribute('color', new Float32BufferAttribute(new Float32Array(vertices * 3), 3))
    .setAttribute('groundSelect', new Float32BufferAttribute(new Float32Array(vertices * 3), 3))
    .setAttribute(MARK_BOX, new Float32BufferAttribute(new Float32Array(vertices * 4), 4));
  const macro = new DataTexture(new Uint8Array(4), 1, 1);
  // the macro read is biased: three emits a sampler for it, and none for a nearest-filtered texture
  macro.minFilter = macro.magFilter = LinearFilter;
  macro.needsUpdate = true;
  const mask = new DataTexture(new Uint8Array(2), 1, 1, RGFormat, UnsignedByteType);
  mask.unpackAlignment = 1;
  mask.needsUpdate = true;
  const material = createGroundPbrMaterial(
    maps,
    macro,
    { x: 0, y: 0 },
    { texture: mask, width: 1, height: 1 },
  );
  return {
    geometry,
    material,
    dispose: () => {
      geometry.dispose();
      macro.dispose();
      mask.dispose();
    },
  };
}

/** Floodlight masts the yard has at night on High, and how many of them cast. */
const YARD_MASTS = 4;

/**
 * The PBR ground on stand-in maps under the whole light set High has at night: the HDRI sun
 * without a shadow, the sky probe, the yard's mast lights, two of them casting, and the lamp lights, the beam and the
 * trailer's light mapped and casting. Rejects when its fragment shader declares more than `SAMPLER_CEILING` samplers.
 */
export function pbrGroundNightSample(): GradeSample {
  const unit = (): Texture => {
    const texture = new DataTexture(new Uint8Array(4), 1, 1);
    texture.needsUpdate = true;
    return texture;
  };
  const maps: TextureMaps<PbrKey> = {
    concreteAlbedo: unit(),
    concretePacked: unit(),
    asphaltAlbedo: unit(),
    asphaltPacked: unit(),
    paversAlbedo: unit(),
    paversPacked: unit(),
  };
  const standIn = groundStandIn(maps);
  setGraded(standIn.material, true);
  const mesh = new Mesh(standIn.geometry, standIn.material);
  mesh.receiveShadow = true;
  const lamps = sampleLampLights();
  // the yard's mast lights: no map, and a shadow on the masts that cast
  const masts = Array.from({ length: YARD_MASTS }, (_, i) => {
    const mast = new SpotLight();
    mast.castShadow = i < FLOOD_SHADOW.casting;
    return mast;
  });
  return {
    mesh,
    lights: [new DirectionalLight(), new LightProbe(), ...lamps.lights, ...masts],
    markers: [GROUND_PBR_MARKER, GRADE_SHADER_MARKER],
    maxSamplers: SAMPLER_CEILING,
    dispose: () => {
      lamps.dispose();
      for (const mast of masts) mast.dispose();
      standIn.material.dispose();
      standIn.dispose();
      for (const map of Object.values(maps)) map.dispose();
    },
  };
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
