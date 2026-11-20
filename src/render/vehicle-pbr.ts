import {
  BoxGeometry,
  Color,
  Float32BufferAttribute,
  Layers,
  type Material,
  Mesh,
  type Object3D,
  PerspectiveCamera,
  type RenderTarget,
  Scene,
  type Texture,
} from 'three';
import { distance, float, max, mix, smoothstep, vec3, vertexColor } from 'three/tsl';
import {
  MeshStandardNodeMaterial,
  type Node,
  type NodeBuilder,
  PhysicalLightingModel,
  PMREMGenerator,
  type WebGPURenderer,
} from 'three/webgpu';
import type { LightingMode, ScenePalette } from '../contracts/render';
import { createSceneSky, domeGround } from './scene-sky';
import { buildSerially, GRADE_SHADER_MARKER, gradeDisabled, setGraded } from './grade';
import { createLampEmission, type LampEmission, withSlot } from './lamp-lens';
import { REALISM_HUES } from './realism-hues';
import { enableLayers, gpuLost, TOP_DOWN_LAYERS } from './seams';

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

/** Named in the generated shader, so a shader error can be traced to this material. */
export const VEHICLE_SHADER_MARKER = 'vehicleGlass';

type LightingContext = {
  readonly iblIrradiance: Node<'vec3'>;
  readonly reflectedLight: {
    readonly directSpecular: Node<'vec3'>;
    readonly indirectSpecular: Node<'vec3'>;
  };
};

/**
 * No diffuse light from the sky map: the hemisphere light already is the ambient term, so the
 * diffuse shading stays the Lambert look and the map only adds reflections. Both specular terms
 * are scaled by `share`. Relies on three internals; vehicle-pbr.test.ts pins them.
 */
export class VehicleLightingModel extends PhysicalLightingModel {
  readonly share: Node<'float'>;

  constructor(share: Node<'float'>) {
    super();
    this.share = share;
  }

  override start(builder: NodeBuilder): void {
    super.start(builder);
    const { reflectedLight } = builder.context as LightingContext;
    reflectedLight.directSpecular.mulAssign(this.share);
    reflectedLight.indirectSpecular.mulAssign(this.share);
  }

  override indirectSpecular(builder: NodeBuilder): void {
    (builder.context as LightingContext).iblIrradiance.assign(vec3(0));
    super.indirectSpecular(builder);
  }
}

/** Roles from the vertex colour: glass and aluminium get their own roughness, metalness and specular share. */
export class VehicleNodeMaterial extends MeshStandardNodeMaterial {
  static override get type(): string {
    return 'VehicleNodeMaterial';
  }

  readonly specularShare: Node<'float'>;

  constructor(envMap: Texture) {
    // the vertex colour is folded into colorNode, so the glass albedo is not multiplied by it again
    super({ vertexColors: false, roughness: PAINT_ROUGHNESS, metalness: 0, envMap });
    const [lo, hi] = ROLE_TOLERANCE;
    const rgb = vertexColor().rgb;
    const role = (hue: number, near: number, far: number) => {
      const c = new Color(hue);
      return float(1).sub(smoothstep(near, far, distance(rgb, vec3(c.r, c.g, c.b))));
    };
    const metal = role(ROLE_HUES.metal, lo, hi);
    const glass = role(ROLE_HUES.glass, lo / 2, hi / 2).toVar(VEHICLE_SHADER_MARKER);
    this.colorNode = mix(rgb, vec3(GLASS_REFLECTANCE), glass);
    this.roughnessNode = mix(
      mix(float(PAINT_ROUGHNESS), GLASS_ROUGHNESS, glass),
      METAL_ROUGHNESS,
      metal,
    );
    this.metalnessNode = mix(mix(float(0), 1, glass), METAL_METALNESS, metal);
    this.specularShare = mix(float(PAINT_SPECULAR), 1, max(glass, metal));
  }

  override setupLightingModel(): VehicleLightingModel {
    return new VehicleLightingModel(this.specularShare);
  }
}

/**
 * The one reflective material every perspective-only vehicle mesh shares, so a swap adds no draw
 * call; it lights the lenses from `lamps` like the detail material does.
 */
export function createVehicleMaterial(envMap: Texture, lamps: LampEmission): VehicleNodeMaterial {
  const material = new VehicleNodeMaterial(envMap);
  material.emissiveNode = lamps.node;
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

/**
 * Builds the reflective material once on `gpu` and resolves whether it compiled. three swaps a
 * material whose node graph throws for a plain one and only logs it, so the built shader must carry
 * the marker.
 */
export function vehicleShaderCompiles(gpu: WebGPURenderer, envMap: Texture): Promise<boolean> {
  return buildSerially(gpu, () => buildVehicleShader(gpu, envMap));
}

async function buildVehicleShader(gpu: WebGPURenderer, envMap: Texture): Promise<boolean> {
  const material = createVehicleMaterial(envMap, createLampEmission());
  // only High reflects, and High grades: check the graded variant the vehicles wear
  const graded = !gradeDisabled();
  setGraded(material, graded);
  const geometry = withSlot(new BoxGeometry());
  geometry.setAttribute('color', new Float32BufferAttribute(new Float32Array(24 * 3), 3));
  const mesh = new Mesh(geometry, material);
  const scene = new Scene();
  scene.add(mesh);
  const { debug } = gpu;
  const previous = debug.onShaderError;
  let accepted = true;
  // only the WebGL 2 backend reports here; a node build error rejects compileAsync on either
  const watcher: NonNullable<typeof previous> = (context, program, vertex, fragment) => {
    if (context.getShaderSource(fragment)?.includes(VEHICLE_SHADER_MARKER) === true) {
      accepted = false;
      console.warn(
        'Vehicle reflection shader failed',
        context.getShaderInfoLog(vertex),
        context.getShaderInfoLog(fragment),
        context.getProgramInfoLog(program),
      );
    } else if (previous !== null) previous(context, program, vertex, fragment);
    else
      console.error(
        'Shader error',
        context.getShaderInfoLog(vertex),
        context.getShaderInfoLog(fragment),
        context.getProgramInfoLog(program),
      );
  };
  debug.onShaderError = watcher;
  try {
    const { fragmentShader } = await gpu.debug.getShaderAsync(scene, new PerspectiveCamera(), mesh);
    const markers = graded ? [VEHICLE_SHADER_MARKER, GRADE_SHADER_MARKER] : [VEHICLE_SHADER_MARKER];
    if (!markers.every((marker) => fragmentShader?.includes(marker) === true)) {
      console.warn('Vehicle reflection shader failed to build');
      return false;
    }
    return accepted;
  } catch (error) {
    console.warn('Vehicle reflection shader failed', error);
    return false;
  } finally {
    if (debug.onShaderError === watcher) debug.onShaderError = previous;
    material.dispose();
    geometry.dispose();
  }
}

/** The sky the vehicles reflect, shared by every visual of one renderer. */
export interface VehicleEnvironment {
  /** Where maps are generated; a different renderer (after a loss) replaces the previous one and drops its map and any failure. */
  attach(gpu: WebGPURenderer): void;
  /**
   * The reflection map for `palette`, or null while it is not ready: without a renderer, while its
   * context is lost, while the map is checked (`onChange` fires when it is ready), or after a
   * failure (retried only on a new renderer).
   */
  texture(palette: ScenePalette, mode: LightingMode): Texture | null;
  /** `listener` runs when `texture` may now return something else; returns the unsubscribe. */
  onChange(listener: () => void): () => void;
  /** A visual reports whether it currently wears the reflective material, for the state. */
  reportApplied(owner: object, on: boolean): void;
  /**
   * The HDRI sky texture the map is captured from, or null for the analytic sky. The current map
   * stays until the new one has passed its check.
   */
  setSky(map: Texture | null): void;
  dispose(): void;
}

/** `on`: some vehicle wears the reflective material; `failed`: vehicles stay plain; null: none does. */
export type VehicleEnvironmentState = 'on' | 'failed' | null;

export interface VehicleEnvironmentParts {
  readonly generate: (
    gpu: WebGPURenderer,
    palette: ScenePalette,
    sky: Texture | null,
    mode: LightingMode,
  ) => RenderTarget;
  readonly compiles: (gpu: WebGPURenderer, map: Texture) => Promise<boolean>;
}

export function generateSkyMap(
  gpu: WebGPURenderer,
  palette: ScenePalette,
  hdri: Texture | null = null,
  mode: LightingMode = 'day',
): RenderTarget {
  // untoned: the reflective material tone-maps what it reflects
  const sky = createSceneSky(palette, false, mode);
  // only High captures, and it lights the perspective views with the split rig; the night dome has no HDRI
  if (mode === 'day') {
    sky.setGround(domeGround(palette, true));
    sky.setHdri(hdri);
  }
  // the dome sits on PERSPECTIVE_LAYER for the game cameras; the capture camera sees layer 0 only
  sky.mesh.layers.set(0);
  const scene = new Scene();
  scene.add(sky.mesh);
  const generator = new PMREMGenerator(gpu);
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
  let renderer: WebGPURenderer | null = null;
  let target: RenderTarget | null = null;
  let skyMap: Texture | null = null;
  /** The sky `target` was captured from. */
  let targetSky: Texture | null = null;
  /** The map being checked; a newer request (palette, renderer) drops it. */
  let pending: RenderTarget | null = null;
  let key = '';
  let failed = false;
  const wearing = new Set<object>();
  const listeners = new Set<() => void>();

  const publish = (): void => {
    if (failed) onState('failed');
    else onState(wearing.size > 0 && target !== null ? 'on' : null);
  };
  const changed = (): void => {
    for (const listener of [...listeners]) listener();
  };
  const release = (): void => {
    const had = target !== null;
    target?.dispose();
    target = null;
    pending?.dispose();
    pending = null;
    if (had) changed();
  };
  const fail = (error: unknown): void => {
    failed = true;
    publish();
    console.warn('Vehicle reflections failed; keeping the plain shading', error);
  };
  const check = (gpu: WebGPURenderer, made: RenderTarget, sky: Texture | null): void => {
    pending = made;
    compiles(gpu, made.texture).then(
      (ok) => {
        if (pending !== made) return;
        pending = null;
        // a compile on a lost context passes vacuously; the renderer that replaces it checks again
        if (gpuLost(gpu)) {
          made.dispose();
          return;
        }
        if (!ok) {
          made.dispose();
          fail(new Error('the reflective shader did not compile'));
          return;
        }
        target?.dispose();
        target = made;
        targetSky = sky;
        publish();
        changed();
      },
      (error: unknown) => {
        if (pending !== made) return;
        pending = null;
        made.dispose();
        fail(error);
      },
    );
  };

  return {
    attach(gpu) {
      if (gpu === renderer) return;
      release();
      key = '';
      failed = false;
      publish();
      renderer = gpu;
    },
    texture(palette, mode) {
      if (renderer === null || gpuLost(renderer)) return null;
      const next = `${palette.sky}/${palette.verge}/${mode}`;
      // the night dome has no HDRI to follow
      const sky = mode === 'night' ? null : skyMap;
      if (next !== key) {
        release();
        key = next;
        failed = false;
      }
      if ((target === null || targetSky !== sky) && pending === null && !failed) {
        try {
          check(renderer, generate(renderer, palette, sky, mode), sky);
        } catch (error) {
          fail(error);
        }
      }
      return target?.texture ?? null;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reportApplied(owner, on) {
      if (on) wearing.add(owner);
      else wearing.delete(owner);
      publish();
    },
    setSky(map) {
      if (map === skyMap) return;
      skyMap = map;
      pending?.dispose();
      pending = null;
      changed();
    },
    dispose() {
      release();
      renderer = null;
      wearing.clear();
      listeners.clear();
      publish();
    },
  };
}
