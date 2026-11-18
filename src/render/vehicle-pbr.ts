import {
  BoxGeometry,
  Color,
  Float32BufferAttribute,
  Layers,
  type Material,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  type Texture,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import type { ScenePalette } from '../contracts/render';
import { createSceneSky } from './environment';
import { REALISM_HUES } from './realism-hues';
import { enableLayers, TOP_DOWN_LAYERS } from './seams';

/*
 * Reflective vehicle shading for the High preset (#69). The map goes on each material, never on
 * `scene.environment`, which would also light the ground and move top-down pixels.
 */

const MAP_SIZE = 128;
const MAP_NEAR = 0.1;
const MAP_FAR = 10;

const PAINT_ROUGHNESS = 0.45;
/**
 * Share of the reflections and sun highlight the paint keeps. A full dielectric highlight would
 * wash the deep livery blues grey, so the paint stays close to its Lambert look with a faint sheen.
 */
const PAINT_SPECULAR = 0.1;
const GLASS_ROUGHNESS = 0.15;
/** Specular colour of the glass role, a dark mirror so the sky shows in the windscreen. */
const GLASS_REFLECTANCE = 0.075;
const METAL_ROUGHNESS = 0.3;
const METAL_METALNESS = 0.5;
/** Linear-space distance within which a vertex colour counts as a role's hue. */
export const ROLE_TOLERANCE = [0.015, 0.04] as const;

/**
 * The hue that selects a role in the shader. Anthracite is reserved for glass: dark plastic and
 * rubber use `chevronBlack`, which stays matte.
 */
export const ROLE_HUES = {
  glass: REALISM_HUES.anthracite,
  metal: REALISM_HUES.whiteAluminium,
} as const;

const glsl = (hue: number): string => {
  const c = new Color(hue);
  return `vec3(${c.r.toFixed(6)}, ${c.g.toFixed(6)}, ${c.b.toFixed(6)})`;
};

const ROLE_ANCHOR = '#include <metalnessmap_fragment>';
const IBL_ANCHOR = '#include <lights_fragment_maps>';
const SPECULAR_ANCHOR = '#include <aomap_fragment>';

function patch(source: string, anchor: string, addition: string): string {
  if (!source.includes(anchor)) throw new Error(`Vehicle shader anchor missing: ${anchor}`);
  return source.replace(anchor, () => addition);
}

/**
 * Roles from the vertex colour, and no diffuse light from the sky map: the hemisphere light already
 * is the ambient term, so the diffuse shading stays the Lambert look and the map only adds
 * reflections. Throws when three's shader no longer has an anchor.
 */
export function roleShader(
  shader: Pick<WebGLProgramParametersWithUniforms, 'fragmentShader'>,
): void {
  const [lo, hi] = ROLE_TOLERANCE;
  let source = patch(
    shader.fragmentShader,
    ROLE_ANCHOR,
    /* glsl */ `${ROLE_ANCHOR}
      float roleMetal = 1.0 - smoothstep(${lo}, ${hi}, distance(vColor.rgb, ${glsl(ROLE_HUES.metal)}));
      float roleGlass = 1.0 - smoothstep(${lo / 2}, ${hi / 2}, distance(vColor.rgb, ${glsl(ROLE_HUES.glass)}));
      roughnessFactor = mix(mix(roughnessFactor, ${GLASS_ROUGHNESS.toFixed(3)}, roleGlass), ${METAL_ROUGHNESS.toFixed(3)}, roleMetal);
      metalnessFactor = mix(mix(metalnessFactor, 1.0, roleGlass), ${METAL_METALNESS.toFixed(3)}, roleMetal);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${GLASS_REFLECTANCE.toFixed(3)}), roleGlass);`,
  );
  source = patch(source, IBL_ANCHOR, `${IBL_ANCHOR}\n iblIrradiance = vec3(0.0);`);
  source = patch(
    source,
    SPECULAR_ANCHOR,
    /* glsl */ `${SPECULAR_ANCHOR}
      float specularShare = mix(${PAINT_SPECULAR.toFixed(3)}, 1.0, max(roleGlass, roleMetal));
      reflectedLight.directSpecular *= specularShare;
      reflectedLight.indirectSpecular *= specularShare;`,
  );
  shader.fragmentShader = source;
}

const PROGRAM_KEY = 'vehicle-roles';

/** The one reflective material every perspective-only vehicle mesh shares, so a swap adds no draw call. */
export function createVehicleMaterial(envMap: Texture): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: PAINT_ROUGHNESS,
    metalness: 0,
    envMap,
  });
  material.onBeforeCompile = roleShader;
  material.customProgramCacheKey = () => PROGRAM_KEY;
  return material;
}

const topDownLayers = new Layers();
enableLayers(topDownLayers, TOP_DOWN_LAYERS);

/**
 * Puts `to` on every mesh below the roots that wears one of `from`. A mesh the top-down camera
 * sees is skipped, so the schematic keeps its tokens.
 */
export function replaceMaterial(
  roots: readonly Object3D[],
  from: readonly Material[],
  to: Material,
): void {
  const skipped = new Set<Object3D>();
  for (const root of roots) {
    root.traverse((o) => {
      if (!(o instanceof Mesh) || Array.isArray(o.material)) return;
      if (!from.includes(o.material as Material) || o.material === to) return;
      if (o.layers.test(topDownLayers)) skipped.add(o);
      else o.material = to;
    });
  }
  if (skipped.size > 0) {
    console.warn(`Vehicle reflections skipped ${skipped.size} mesh(es) the top-down view draws`);
  }
}

/** Compiles the reflective program once and reports whether the GPU accepted it. */
export function vehicleShaderCompiles(gl: WebGLRenderer, envMap: Texture): boolean {
  const material = createVehicleMaterial(envMap);
  const geometry = new BoxGeometry();
  geometry.setAttribute('color', new Float32BufferAttribute(new Float32Array(24 * 3), 3));
  const scene = new Scene();
  scene.add(new Mesh(geometry, material));
  const previous = gl.debug.onShaderError;
  let accepted = true;
  gl.debug.onShaderError = (context, program, vertex, fragment) => {
    accepted = false;
    console.warn(
      'Vehicle reflection shader failed',
      context.getShaderInfoLog(vertex),
      context.getShaderInfoLog(fragment),
      context.getProgramInfoLog(program),
    );
  };
  try {
    gl.compile(scene, new PerspectiveCamera());
    // three checks the link status on first use; this forces it while the hook is installed
    for (const program of gl.info.programs ?? []) {
      if (program.cacheKey.includes(PROGRAM_KEY)) program.getUniforms();
    }
    return accepted;
  } catch (error) {
    console.warn('Vehicle reflection shader failed', error);
    return false;
  } finally {
    gl.debug.onShaderError = previous;
    material.dispose();
    geometry.dispose();
  }
}

/** The sky the vehicles reflect, shared by every visual of one renderer. */
export interface VehicleEnvironment {
  /** Where maps are generated; a different renderer replaces the previous one and drops its map. */
  attach(gl: WebGLRenderer): void;
  /**
   * The reflection map for `palette`, generated and shader-checked on first use; null without a
   * renderer, while its context is lost, or after a failure (retried only after `invalidate`).
   */
  texture(palette: ScenePalette): Texture | null;
  /** Drops the map and a recorded failure; call when the GPU resources are gone (context restored). */
  invalidate(): void;
  /** A visual reports whether it currently wears the reflective material, for the state. */
  reportApplied(owner: object, on: boolean): void;
  dispose(): void;
}

/** `on`: some vehicle wears the reflective material; `failed`: vehicles stay plain; null: none does. */
export type VehicleEnvironmentState = 'on' | 'failed' | null;

export interface VehicleEnvironmentParts {
  readonly generate: (gl: WebGLRenderer, palette: ScenePalette) => WebGLRenderTarget;
  readonly compiles: (gl: WebGLRenderer, map: Texture) => boolean;
}

export function generateSkyMap(gl: WebGLRenderer, palette: ScenePalette): WebGLRenderTarget {
  const sky = createSceneSky(palette);
  // the dome sits on SKY_LAYER for the game cameras; the capture camera sees layer 0 only
  sky.mesh.layers.set(0);
  const scene = new Scene();
  scene.add(sky.mesh);
  const generator = new PMREMGenerator(gl);
  try {
    return generator.fromScene(scene, 0, MAP_NEAR, MAP_FAR, { size: MAP_SIZE });
  } finally {
    generator.dispose();
    sky.dispose();
  }
}

export function createVehicleEnvironment(
  onState: (state: VehicleEnvironmentState) => void = () => undefined,
  { generate, compiles }: VehicleEnvironmentParts = {
    generate: generateSkyMap,
    compiles: vehicleShaderCompiles,
  },
): VehicleEnvironment {
  let renderer: WebGLRenderer | null = null;
  let target: WebGLRenderTarget | null = null;
  let key = '';
  let failed = false;
  const wearing = new Set<object>();

  const publish = (): void => {
    if (failed) onState('failed');
    else onState(wearing.size > 0 && target !== null ? 'on' : null);
  };
  const release = (): void => {
    target?.dispose();
    target = null;
  };
  const invalidate = (): void => {
    release();
    key = '';
    failed = false;
    publish();
  };

  return {
    attach(gl) {
      if (gl === renderer) return;
      invalidate();
      renderer = gl;
    },
    texture(palette) {
      if (renderer === null || renderer.getContext().isContextLost()) return null;
      const next = `${palette.sky}/${palette.verge}`;
      if (next !== key) {
        release();
        key = next;
        failed = false;
      }
      if (target === null && !failed) {
        try {
          const made = generate(renderer, palette);
          if (!compiles(renderer, made.texture)) {
            made.dispose();
            throw new Error('the reflective shader did not compile');
          }
          target = made;
          publish();
        } catch (error) {
          failed = true;
          publish();
          console.warn('Vehicle reflections failed; keeping the plain shading', error);
        }
      }
      return target?.texture ?? null;
    },
    invalidate,
    reportApplied(owner, on) {
      if (on) wearing.add(owner);
      else wearing.delete(owner);
      publish();
    },
    dispose() {
      release();
      renderer = null;
      wearing.clear();
      publish();
    },
  };
}
