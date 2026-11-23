import {
  BoxGeometry,
  DirectionalLight,
  Float32BufferAttribute,
  LightProbe,
  Mesh,
  PerspectiveCamera,
  Scene,
  type Texture,
} from 'three';
import { float, vertexColor } from 'three/tsl';
import { MeshStandardNodeMaterial, type WebGPURenderer } from 'three/webgpu';
import { GRADE, GRADE_SHADER_MARKER, gradeDisabled, setGraded } from './grade';
import {
  buildSerially,
  compileShader,
  watchShaderErrors,
  wgslAccepted,
  type Compiled,
} from './shader-check';
import { gpuLost } from './seams';
import { VehicleLightingModel } from './vehicle-pbr';

/*
 * The cab interior's lit material for the High preset (#159). Unlike the vehicle shell's, it has no
 * glass role: the dash is anthracite, which the shell reads as a mirror. A satin plastic keeps the
 * highlights faint, so the dash neither glares in the windscreen nor washes out. The sky map goes on
 * the material, never on `scene.environment`.
 */

const ROUGHNESS = 0.75;
/** Share of the reflections and sun highlight the plastic keeps. */
const SPECULAR = 0.2;

/** Named in the generated shader, so a shader error can be traced to this material. */
export const INTERIOR_SHADER_MARKER = 'interiorLit';

export class InteriorNodeMaterial extends MeshStandardNodeMaterial {
  static override get type(): string {
    return 'InteriorNodeMaterial';
  }

  constructor(envMap: Texture | null = null) {
    // the vertex colour is folded into colorNode
    super({ vertexColors: false, roughness: ROUGHNESS, metalness: 0, envMap });
    this.colorNode = vertexColor().rgb.mul(GRADE.interiorLight).toVar(INTERIOR_SHADER_MARKER);
  }

  override setupLightingModel(): VehicleLightingModel {
    return new VehicleLightingModel(float(SPECULAR));
  }
}

/**
 * Builds the interior material on `gpu` the way the cockpit draws it on High: with `envMap`, graded
 * unless the grade is off, as a shadow receiver under a casting sun and a light probe. Resolves
 * whether it compiled. three swaps a material whose node graph throws for a plain one and only logs
 * it, so the built shader must carry the marker.
 */
export async function interiorShaderCompiles(
  gpu: WebGPURenderer,
  envMap: Texture,
): Promise<boolean> {
  const built = await buildSerially(gpu, () => buildInteriorShader(gpu, envMap));
  return built !== null && (await wgslAccepted(gpu, built, 'Interior shader'));
}

/** The built program, or null when it failed. */
async function buildInteriorShader(gpu: WebGPURenderer, envMap: Texture): Promise<Compiled | null> {
  const material = new InteriorNodeMaterial(envMap);
  const graded = !gradeDisabled();
  setGraded(material, graded);
  const geometry = new BoxGeometry();
  geometry.setAttribute('color', new Float32BufferAttribute(new Float32Array(24 * 3), 3));
  const mesh = new Mesh(geometry, material);
  mesh.receiveShadow = true;
  const sun = new DirectionalLight();
  sun.castShadow = true;
  const scene = new Scene();
  scene.add(mesh, sun, new LightProbe());
  const verdict = { accepted: true };
  // only the WebGL 2 backend reports here; a node build error rejects the build on either
  const restore = watchShaderErrors(gpu, {
    matches: (source) => source?.includes(INTERIOR_SHADER_MARKER) === true,
    onMatch: (logs) => {
      verdict.accepted = false;
      console.warn('Interior shader failed', ...logs());
    },
    unwatchedLabel: 'Shader error',
  });
  try {
    const built = await compileShader(gpu, scene, new PerspectiveCamera(), mesh);
    const markers = graded
      ? [INTERIOR_SHADER_MARKER, GRADE_SHADER_MARKER]
      : [INTERIOR_SHADER_MARKER];
    if (!markers.every((marker) => built.fragment?.includes(marker) === true)) {
      console.warn('Interior shader failed to build');
      return null;
    }
    return verdict.accepted ? built : null;
  } catch (error) {
    console.warn('Interior shader failed', error);
    return null;
  } finally {
    restore();
    material.dispose();
    geometry.dispose();
    sun.shadow.dispose();
  }
}

export type InteriorVerdict = 'ok' | 'failed' | 'pending';

/**
 * What of a sky map can change the interior's program: three keys a material on its map's mapping,
 * encoding, filters, format and size, not on which texture it is. Two maps with one key build one
 * program, so the HDRI sky replacing the analytic one needs no new check.
 */
export function programKey(map: Texture): string {
  const { width, height } = map.image as { width?: number; height?: number };
  return [
    map.mapping,
    map.colorSpace,
    map.minFilter,
    map.magFilter,
    map.format,
    map.type,
    map.channel,
    map.isRenderTargetTexture,
    width,
    height,
  ].join('/');
}

/** Whether the lit interior compiles on the live renderer with the kind of sky map it will wear. */
export interface InteriorCheck {
  /** The renderer the checks run on; a different one drops every verdict. */
  attach(gpu: WebGPURenderer): void;
  /**
   * `ok` once a map of `map`'s program built the interior shader, `failed` if it did not, `pending`
   * while it is checked or without a renderer. The first ask for a program starts its check.
   */
  verdict(map: Texture): InteriorVerdict;
  /** `listener` runs when a verdict is settled; returns the unsubscribe. */
  onChange(listener: () => void): () => void;
  dispose(): void;
}

export function createInteriorCheck(
  compiles: (gpu: WebGPURenderer, map: Texture) => Promise<boolean> = interiorShaderCompiles,
  keyOf: (map: Texture) => string = programKey,
): InteriorCheck {
  let renderer: WebGPURenderer | null = null;
  let verdicts = new Map<string, InteriorVerdict>();
  const listeners = new Set<() => void>();
  const settle = (gpu: WebGPURenderer, key: string, ok: boolean): void => {
    // a stale request, or a compile on a lost context, which passes vacuously
    if (renderer !== gpu || verdicts.get(key) !== 'pending') return;
    if (gpuLost(gpu)) {
      verdicts.delete(key);
      return;
    }
    verdicts.set(key, ok ? 'ok' : 'failed');
    for (const listener of [...listeners]) listener();
  };
  return {
    attach(gpu) {
      if (gpu === renderer) return;
      renderer = gpu;
      verdicts = new Map();
    },
    verdict(map) {
      const gpu = renderer;
      if (gpu === null) return 'pending';
      const key = keyOf(map);
      const known = verdicts.get(key);
      if (known !== undefined) return known;
      verdicts.set(key, 'pending');
      compiles(gpu, map).then(
        (ok) => settle(gpu, key, ok),
        (error: unknown) => {
          console.warn('Interior shader failed', error);
          settle(gpu, key, false);
        },
      );
      return 'pending';
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      renderer = null;
      verdicts = new Map();
      listeners.clear();
    },
  };
}
