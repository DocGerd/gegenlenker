import {
  AmbientLight,
  BoxGeometry,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  Group,
  LightProbe,
  Mesh,
  NoBlending,
  PerspectiveCamera,
  Scene,
  type BufferGeometry,
} from 'three';
import { dot, float, max, normalMap, sqrt, texture, uv, vec2, vec3, vec4 } from 'three/tsl';
import {
  MeshStandardNodeMaterial,
  type Node,
  NodeMaterial,
  type WebGPURenderer,
} from 'three/webgpu';
import { isKitDecor, type KitPlacement, type ResolvedLayout } from '../contracts/layout';
import { DEFAULT_LIGHTING, type LightingMode, type ScenePalette } from '../contracts/render';
import atlasAUrl from './assets/yard-kit-atlas-a.ktx2?url';
import atlasBUrl from './assets/yard-kit-atlas-b.ktx2?url';
import leavesUrl from './assets/yard-kit-leaves.ktx2?url';
import kitUrl from './assets/yard-kit.glb?url';
import { GRADE_SHADER_MARKER, gradeDisabled, type GradeSample, setGraded } from './grade';
import type { Look } from './look';
import {
  COCKPIT_LAYERS,
  enableLayers,
  gpuLost,
  PERSPECTIVE_LAYER,
  YARD_CASTER_LAYER,
} from './seams';
import { verifyShader } from './shader-check';
import { startShells, type Shells } from './glb-shells';
import { startTextureSet, TEXTURE_FAILED, type TextureMaps, type TextureSet } from './texture-set';
import { VehicleLightingModel, type VehicleEnvironment } from './vehicle-pbr';
import { mergeKit, parseKitGlb, type KitPieces } from './yard-kit-pieces';

/*
 * The yard kit (tools/blender/yard_kit.py, issue #160): the surroundings outside the yard, on High.
 * One merged mesh per material on PERSPECTIVE_LAYER; the top-down view never draws it. It casts the
 * sun's shadow where the sun does (High); the atlas mesh receives it, the leaf cards do not
 * (double-sided cards shadow themselves into acne). At night, where the floodlights cast, a proxy
 * of each mesh on `YARD_CASTER_LAYER` alone casts into their maps, so the lamps' passes never draw
 * the kit. Both materials are standard PBR with the kit's atlases, and take the vehicles' sky map
 * as a reflection where there is one.
 */

/** Names the kit's atlas shader, so a compile error can be traced to it. */
export const YARD_KIT_SHADER_MARKER = 'yardKit';

const ANISOTROPY = 8; // three clamps this to what the GPU offers
/**
 * Atlas B holds OpenGL normals (green up the image), but the meshes have no tangents, so three takes
 * the bitangent along +v, which runs down the image: Y is negated, as GLTFLoader does.
 */
export const KIT_NORMAL_SCALE = [1, -1] as const;
const ALPHA_CUT = 0.5;
const MAX_GLB_ATTEMPTS = 2;
const LEAF_ROUGHNESS = 0.9;
/** Share of the reflections and sun highlight a leaf keeps. */
const LEAF_SPECULAR = 0.05;

export type KitTextureKey = 'atlasA' | 'atlasB' | 'leaves';

/** The kit's lit material: the vehicles' lighting, so the sky map adds reflections but no diffuse light. */
class KitNodeMaterial extends MeshStandardNodeMaterial {
  static override get type(): string {
    return 'KitNodeMaterial';
  }

  readonly specularShare: Node<'float'>;

  constructor(specularShare: Node<'float'>) {
    super({ metalness: 0, side: DoubleSide });
    this.specularShare = specularShare;
  }

  override setupLightingModel(): VehicleLightingModel {
    return new VehicleLightingModel(this.specularShare);
  }
}

export type KitMaterials = { readonly atlas: KitNodeMaterial; readonly leaves: KitNodeMaterial };

/**
 * The atlas material reads albedo from atlas A and tangent-space normal XY, roughness and occlusion
 * from atlas B; the leaf material alpha-cuts the leaf atlas.
 */
export function createKitMaterials(maps: TextureMaps<KitTextureKey>): KitMaterials {
  const packed = texture(maps.atlasB, uv());
  const atlas = new KitNodeMaterial(float(1).sub(packed.b));
  // a vec4: the shadow pass reads its alpha
  const albedo = vec4(texture(maps.atlasA, uv()).rgb, 1).toVar(YARD_KIT_SHADER_MARKER);
  atlas.colorNode = albedo;
  atlas.roughnessNode = packed.b;
  atlas.aoNode = packed.a;
  const xy = packed.rg.mul(2).sub(1);
  const z = sqrt(max(float(0), float(1).sub(dot(xy, xy))));
  atlas.normalNode = normalMap(
    vec3(packed.r, packed.g, z.mul(0.5).add(0.5)),
    vec2(...KIT_NORMAL_SCALE),
  ).toVar();

  const leaves = new KitNodeMaterial(float(LEAF_SPECULAR));
  const leaf = texture(maps.leaves, uv());
  const colour = vec4(leaf.rgb, leaf.a).toVar(YARD_KIT_SHADER_MARKER);
  leaves.colorNode = colour;
  leaves.roughnessNode = float(LEAF_ROUGHNESS);
  leaves.alphaTest = ALPHA_CUT;
  return { atlas, leaves };
}

/**
 * Builds both kit materials for `maps` before any kit wears them, under the perspective light rig
 * and grade, so a node, pipeline or discard error rejects here instead of in a frame. three swaps a
 * material whose node graph throws for a plain one and only logs it, hence the marker check.
 */
export async function precompileYardKit(
  renderer: WebGPURenderer,
  maps: TextureMaps<KitTextureKey>,
): Promise<void> {
  const materials = createKitMaterials(maps);
  const graded = !gradeDisabled();
  const geometry = new BoxGeometry();
  const scene = new Scene();
  // the atlas is built as the sun-shadow receiver it is on High
  const sun = new DirectionalLight();
  sun.castShadow = true;
  const lights = [sun, new LightProbe(), new AmbientLight()];
  for (const light of lights) light.layers.set(PERSPECTIVE_LAYER);
  scene.add(...lights);
  const camera = new PerspectiveCamera();
  enableLayers(camera.layers, COCKPIT_LAYERS);
  try {
    for (const material of [materials.atlas, materials.leaves]) {
      setGraded(material, graded);
      const mesh = new Mesh(geometry, material);
      mesh.receiveShadow = material === materials.atlas;
      scene.add(mesh);
      const markers = graded
        ? [YARD_KIT_SHADER_MARKER, GRADE_SHADER_MARKER]
        : [YARD_KIT_SHADER_MARKER];
      try {
        await verifyShader(renderer, scene, camera, mesh, {
          subject: 'the yard kit shader',
          markers,
        });
      } finally {
        scene.remove(mesh);
      }
    }
    // a compile on a lost context passes vacuously
    if (gpuLost(renderer)) throw new Error('the GPU context was lost');
  } finally {
    sun.shadow.dispose();
    materials.atlas.dispose();
    materials.leaves.dispose();
    geometry.dispose();
  }
}

/**
 * The kit material's shadow-pass program, for the grade's shader check: a box under an override
 * shaped like the one three puts on a caster in the sun's shadow pass (`Renderer._getShadowNodes`:
 * black, with the material's `colorNode` alpha and its alpha test). three fills that override in
 * while it renders, but `compileAsync` queues its node builders after restoring it, so the check
 * cannot read three's own program. It builds the same graph from the material's `colorNode`, so a
 * lost leaf cut or a GLSL error in it fails the check instead of a frame.
 */
function kitShadowSample(kind: keyof KitMaterials): GradeSample {
  const map = new DataTexture(new Uint8Array(4), 1, 1);
  map.needsUpdate = true;
  const materials = createKitMaterials({ atlasA: map, atlasB: map, leaves: map });
  const geometry = new BoxGeometry();
  const material = materials[kind];
  const shell = new NodeMaterial();
  shell.colorNode = vec4(0, 0, 0, (material.colorNode as Node<'vec4'>).a);
  shell.alphaTest = material.alphaTest;
  shell.blending = NoBlending;
  shell.fog = false;
  return {
    mesh: new Mesh(geometry, material),
    override: shell,
    markers: kind === 'leaves' ? [YARD_KIT_SHADER_MARKER, 'discard'] : [YARD_KIT_SHADER_MARKER],
    dispose: () => {
      geometry.dispose();
      shell.dispose();
      materials.atlas.dispose();
      materials.leaves.dispose();
      map.dispose();
    },
  };
}

/** The grade check's samples of the kit's shadow casters: the cut leaves and the opaque atlas. */
export const KIT_SHADOW_SAMPLES: readonly (() => GradeSample)[] = [
  () => kitShadowSample('leaves'),
  () => kitShadowSample('atlas'),
];

/** What the kit layer builds its meshes from. */
export type LoadedKit = { readonly maps: TextureMaps<KitTextureKey>; readonly pieces: KitPieces };

/** The kit's three atlases and its glb, loaded and applied together. */
export interface YardKit {
  /** The renderer whose compressed-format support picks the transcoding target; a later one replaces it. */
  attach(renderer: WebGPURenderer): void;
  /** Starts the downloads on the first call with `true`; nothing is fetched before. */
  setEnabled(on: boolean): void;
  /**
   * Calls `apply` once the atlases and the glb have loaded, never when they fail; the returned
   * function cancels. Always asynchronous. The textures are shared: callers must not dispose them.
   * `revert` is called when the GPU rejects the shader.
   */
  onLoaded(apply: (kit: LoadedKit) => void, revert?: () => void): () => void;
  /** A kit layer reports whether it currently draws, for `onApplied`. */
  reportApplied(on: boolean): void;
  dispose(): void;
}

type GlbLoad = (url: string) => Promise<KitPieces>;

const fetchPieces: GlbLoad = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return parseKitGlb(await response.arrayBuffer());
};

/**
 * `onApplied` receives `on` while some layer draws the kit, `failed` once its atlases are given up
 * on, and null otherwise; the offline e2e reads it. A failed load warns and leaves the yard bare.
 */
export function startYardKit(
  onApplied: (state: string | null) => void = () => undefined,
  load: GlbLoad = fetchPieces,
): YardKit {
  // a glb that fails twice is given up on, like the atlases
  let glbFailures = 0;
  let glbFailed = false;
  const publish = (state: string | null): void => {
    onApplied(glbFailed ? TEXTURE_FAILED : state);
  };
  const textures: TextureSet<KitTextureKey> = startTextureSet({
    urls: { atlasA: atlasAUrl, atlasB: atlasBUrl, leaves: leavesUrl },
    prepare: (key, map) => {
      map.anisotropy = key === 'leaves' ? 4 : ANISOTROPY;
    },
    precompile: precompileYardKit,
    describe: () => 'on',
    onApplied: publish,
    label: 'Yard kit',
    fallback: 'the bare surroundings',
    marker: YARD_KIT_SHADER_MARKER,
  });
  const glb: Shells<KitPieces> = startShells(
    { 'yard-kit': kitUrl },
    {
      enabled: false,
      load: async (url) => {
        try {
          const pieces = await load(url);
          glbFailures = 0;
          glbFailed = false;
          return pieces;
        } catch (error) {
          if (++glbFailures >= MAX_GLB_ATTEMPTS) {
            glbFailed = true;
            publish(null);
          }
          throw error;
        }
      },
    },
  );
  return {
    attach: (renderer) => {
      textures.attach(renderer);
    },
    setEnabled: (on) => {
      textures.setEnabled(on);
      glb.setEnabled(on);
    },
    onLoaded: (apply, revert) => {
      let maps: TextureMaps<KitTextureKey> | null = null;
      let pieces: KitPieces | null = null;
      const ready = (): void => {
        if (maps !== null && pieces !== null) apply({ maps, pieces });
      };
      const cancelTextures = textures.onLoaded((loaded) => {
        maps = loaded;
        ready();
      }, revert);
      const cancelGlb = glb.onLoaded('yard-kit', (loaded) => {
        pieces = loaded;
        ready();
      });
      return () => {
        cancelTextures();
        cancelGlb();
      };
    },
    reportApplied: (on) => {
      textures.reportApplied(on);
    },
    dispose: () => {
      textures.dispose();
    },
  };
}

/** The kit's assets and the sky map its materials reflect. */
export type YardKitParts = { readonly kit: YardKit; readonly reflections: VehicleEnvironment };

export interface YardKitLayer {
  readonly object: Group;
  setLook(look: Look): void;
  dispose(): void;
}

/**
 * The layout's kit decor and kit props as merged meshes under `object`, hidden until the kit has
 * loaded and the preset draws it. `onDrawn` hears each change of whether it does.
 */
export function createYardKitLayer(
  layout: ResolvedLayout,
  palette: ScenePalette,
  parts?: YardKitParts,
  onDrawn?: (drawn: boolean) => void,
): YardKitLayer {
  const { kit, reflections } = parts ?? {};
  const object = new Group();
  object.visible = false;
  const placements: KitPlacement[] = [
    ...layout.decor.filter(isKitDecor),
    ...layout.props.flatMap(({ kit: placed }) => (placed === undefined ? [] : [placed])),
  ];
  type Built = { materials: KitMaterials; geometries: BufferGeometry[] };
  let built: Built | null = null;
  let wanted = false;
  let graded = false;
  let casting = false;
  let yardCasting = false;
  /** Casters for the floodlights' maps: the kit's geometry and material on a layer no camera draws. */
  const proxies: Mesh[] = [];
  const shown: Mesh[] = [];
  let mode: LightingMode = DEFAULT_LIGHTING;
  let drawn = false;

  const sync = (): void => {
    const on = wanted && built !== null;
    object.visible = on;
    for (const mesh of shown) {
      mesh.castShadow = casting;
      mesh.receiveShadow = casting && mesh.material === built?.materials.atlas;
    }
    for (const proxy of proxies) proxy.castShadow = yardCasting;
    if (built !== null) {
      const map = on ? (reflections?.texture(palette, mode) ?? null) : null;
      for (const material of [built.materials.atlas, built.materials.leaves]) {
        setGraded(material, graded);
        if (material.envMap !== map) {
          material.envMap = map;
          material.needsUpdate = true;
        }
      }
    }
    if (on !== drawn) {
      drawn = on;
      kit?.reportApplied(on);
      onDrawn?.(on);
    }
  };
  const release = (): void => {
    if (built === null) return;
    object.clear();
    proxies.length = 0;
    shown.length = 0;
    for (const geometry of built.geometries) geometry.dispose();
    built.materials.atlas.dispose();
    built.materials.leaves.dispose();
    built = null;
    sync();
  };
  const cancel =
    placements.length === 0
      ? undefined
      : kit?.onLoaded(
          ({ maps, pieces }) => {
            const geometries: BufferGeometry[] = [];
            const materials = createKitMaterials(maps);
            try {
              for (const [kind, material] of [
                ['atlas', materials.atlas],
                ['leaves', materials.leaves],
              ] as const) {
                const geometry = mergeKit(pieces, placements, kind);
                if (geometry === null) continue;
                geometries.push(geometry);
                const mesh = new Mesh(geometry, material);
                mesh.layers.set(PERSPECTIVE_LAYER);
                mesh.frustumCulled = false;
                const proxy = new Mesh(geometry, material);
                proxy.layers.set(YARD_CASTER_LAYER);
                proxy.frustumCulled = false;
                proxy.receiveShadow = false;
                proxies.push(proxy);
                shown.push(mesh);
                object.add(mesh, proxy);
              }
            } catch (error) {
              object.clear();
              proxies.length = 0;
              shown.length = 0;
              for (const geometry of geometries) geometry.dispose();
              materials.atlas.dispose();
              materials.leaves.dispose();
              throw error;
            }
            built = { materials, geometries };
            sync();
          },
          () => {
            release();
          },
        );
  const stopWatching = reflections?.onChange(sync);

  return {
    object,
    setLook({ flags, grade, mode: lookMode, shadow, yardShadow }) {
      wanted = flags.yardKit;
      graded = grade.on;
      mode = lookMode;
      casting = shadow;
      yardCasting = yardShadow;
      sync();
    },
    dispose() {
      cancel?.();
      stopWatching?.();
      wanted = false;
      release();
      sync();
    },
  };
}
