import {
  Color,
  type Material,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
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

/*
 * Reflective vehicle shading for the High preset (#69). Only the perspective-only detail material
 * (SKY_LAYER and CAB_LAYER meshes, shells included) becomes a MeshStandardMaterial; the layer-0
 * meshes the top-down camera sees keep their Lambert tokens. The map goes on each material, never on
 * `scene.environment`, which would also light the ground and move top-down pixels.
 */

const MAP_SIZE = 128;
const MAP_NEAR = 0.1;
const MAP_FAR = 10;

/** Satin paint: the default role of every vertex colour. */
const PAINT_ROUGHNESS = 0.45;
/**
 * Share of the reflections and sun highlight the paint keeps. A full dielectric highlight would
 * wash the deep livery blues grey, so the paint stays close to its Lambert look with a faint sheen.
 */
const PAINT_SPECULAR = 0.1;
/** Glossy dark plastic and glass; the vertex colours give no way to tell the two apart. */
const GLASS_ROUGHNESS = 0.15;
/** Specular colour of that role, a dark mirror so the sky shows in the windscreen. */
const GLASS_REFLECTANCE = 0.075;
/** Satin aluminium: half metal keeps the rims as bright as their Lambert grey. */
const METAL_ROUGHNESS = 0.3;
const METAL_METALNESS = 0.5;
/** Linear-space distance within which a vertex colour counts as a role's hue. */
const ROLE_TOLERANCE = [0.015, 0.04] as const;

/** The hue that selects a role in the shader; vertex colours carry no other role data. */
export const ROLE_HUES = {
  glass: REALISM_HUES.anthracite,
  metal: REALISM_HUES.whiteAluminium,
} as const;

const glsl = (hue: number): string => {
  const c = new Color(hue);
  return `vec3(${c.r.toFixed(6)}, ${c.g.toFixed(6)}, ${c.b.toFixed(6)})`;
};

export const ROLE_ANCHOR = '#include <metalnessmap_fragment>';
export const IBL_ANCHOR = '#include <lights_fragment_maps>';
export const SPECULAR_ANCHOR = '#include <aomap_fragment>';

/**
 * Roles from the vertex colour, and no diffuse light from the sky map: the hemisphere light already
 * is the ambient term, so the diffuse shading stays the Lambert look and the map only adds
 * reflections.
 */
export function roleShader(
  shader: Pick<WebGLProgramParametersWithUniforms, 'fragmentShader'>,
): void {
  const [lo, hi] = ROLE_TOLERANCE;
  shader.fragmentShader = shader.fragmentShader
    .replace(
      ROLE_ANCHOR,
      /* glsl */ `${ROLE_ANCHOR}
      float roleMetal = 1.0 - smoothstep(${lo}, ${hi}, distance(vColor.rgb, ${glsl(ROLE_HUES.metal)}));
      float roleGlass = 1.0 - smoothstep(${lo / 2}, ${hi / 2}, distance(vColor.rgb, ${glsl(ROLE_HUES.glass)}));
      roughnessFactor = mix(mix(roughnessFactor, ${GLASS_ROUGHNESS.toFixed(3)}, roleGlass), ${METAL_ROUGHNESS.toFixed(3)}, roleMetal);
      metalnessFactor = mix(mix(metalnessFactor, 1.0, roleGlass), ${METAL_METALNESS.toFixed(3)}, roleMetal);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${GLASS_REFLECTANCE.toFixed(3)}), roleGlass);`,
    )
    .replace(IBL_ANCHOR, `${IBL_ANCHOR}\n iblIrradiance = vec3(0.0);`)
    .replace(
      SPECULAR_ANCHOR,
      /* glsl */ `${SPECULAR_ANCHOR}
      float specularShare = mix(${PAINT_SPECULAR.toFixed(3)}, 1.0, max(roleGlass, roleMetal));
      reflectedLight.directSpecular *= specularShare;
      reflectedLight.indirectSpecular *= specularShare;`,
    );
}

/** The one reflective material every perspective-only vehicle mesh shares, so a swap adds no draw call. */
export function createVehicleMaterial(envMap: Texture): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: PAINT_ROUGHNESS,
    metalness: 0,
    envMap,
  });
  material.onBeforeCompile = roleShader;
  material.customProgramCacheKey = () => 'vehicle-roles';
  return material;
}

/** Puts `to` on every mesh below `root` that wears one of `from`; nothing else is touched. */
export function replaceMaterial(root: Object3D, from: readonly Material[], to: Material): void {
  root.traverse((o) => {
    if (o instanceof Mesh && !Array.isArray(o.material) && from.includes(o.material as Material)) {
      o.material = to;
    }
  });
}

/** The sky the vehicles reflect, shared by every visual of one renderer. */
export interface VehicleEnvironment {
  /** Where maps are generated; the first renderer wins, like the other attach points. */
  attach(gl: WebGLRenderer): void;
  /** The reflection map for `palette`, generated on first use; null without a renderer or on failure. */
  texture(palette: ScenePalette): Texture | null;
  dispose(): void;
}

export function createVehicleEnvironment(): VehicleEnvironment {
  let renderer: WebGLRenderer | null = null;
  let target: WebGLRenderTarget | null = null;
  let key = '';
  let failed = false;

  const release = (): void => {
    target?.dispose();
    target = null;
  };

  function generate(gl: WebGLRenderer, palette: ScenePalette): WebGLRenderTarget {
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

  return {
    attach(gl) {
      renderer ??= gl;
    },
    texture(palette) {
      if (renderer === null) return null;
      const next = `${palette.sky}/${palette.verge}`;
      if (next !== key) {
        release();
        key = next;
        failed = false;
      }
      if (target === null && !failed) {
        try {
          target = generate(renderer, palette);
        } catch (error) {
          failed = true;
          console.warn('Vehicle reflection map failed; keeping the plain shading', error);
        }
      }
      return target?.texture ?? null;
    },
    dispose() {
      release();
      renderer = null;
    },
  };
}
