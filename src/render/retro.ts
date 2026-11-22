import { BoxGeometry, Float32BufferAttribute, Mesh, SpotLight } from 'three';
import { attribute, diffuseColor, exp, float, normalView, positionViewDirection } from 'three/tsl';
import {
  MeshLambertNodeMaterial,
  type Node,
  type NodeBuilder,
  PhongLightingModel,
  type WebGPURenderer,
} from 'three/webgpu';
import { GRADE_SHADER_MARKER, precompileSamples, setGraded, type GradeSample } from './grade';
import { BEAM } from './lamp-light';
import { gpuLost } from './seams';
import { EMIT_ATTRIBUTE, RETRO_ATTRIBUTE, withEmit, withRetro } from './tint';

/*
 * Retro-reflective yard parts at night. A part carries `retro` (1 on sheeting, 0 elsewhere) as a
 * vertex attribute, set from its type alone. The night-only material adds, for every light, a lobe
 * that grows as the angle between the light and the viewer, seen from the surface, shrinks. The add
 * scales the sheeting's own colour and is bounded, so a coloured band keeps its hue and only its
 * dominant channel can saturate. At night the sun is off, so only the lamps drive it; by day the
 * plain props material draws, so day output is unchanged. The same material makes the lamp heads
 * of the yard glow: a part's `emit` attribute is the colour it emits, and zero elsewhere.
 */

/** Named in the generated shader, so a shader error can be traced to this material. */
export const RETRO_SHADER_MARKER = 'retroSheeting';
export const EMIT_SHADER_MARKER = 'headEmission';

export const RETRO = {
  /** Multiplies the light that reaches the surface, before the bound. */
  gain: 2.5,
  /** Steepness of the lobe in `1 - cos(angle)` between the light and the viewer. */
  sharpness: 24,
  /** Most the add can reach from the two dipped lamps together, in units of the surface's own colour: the return is bounded, not clipped. */
  max: 1,
} as const;

/** What one light's add is bounded by: the lamps of a pair share `RETRO.max`. */
const LIGHT_MAX = RETRO.max / 2;

/** Share (0 to 1) of the return at an observation angle between the light and the viewer, in radians. */
export const retroLobe = (angle: number): number =>
  Math.exp(-RETRO.sharpness * (1 - Math.cos(angle)));

/** The add, in units of the surface's colour, of one light `lit` (per channel, as `lightColor` is) on sheeting: below half of `RETRO.max`, rising like `lit` while small. */
export const retroBoost = (lit: number, facing: number, angle: number): number =>
  LIGHT_MAX * (1 - Math.exp(-(lit * facing * retroLobe(angle) * RETRO.gain) / LIGHT_MAX));

/** Lambert, plus the retro lobe of each light on the vertices that carry `retro`. */
class RetroLightingModel extends PhongLightingModel {
  private sheeting: Node<'float'> | null = null;

  constructor() {
    super(false);
  }

  override start(builder: NodeBuilder): void {
    this.sheeting = attribute<'float'>(RETRO_ATTRIBUTE).toVar(RETRO_SHADER_MARKER);
    super.start(builder);
  }

  override direct(...args: Parameters<PhongLightingModel['direct']>): void {
    super.direct(...args);
    if (this.sheeting === null) return;
    const [data] = args;
    const lightDirection = data.lightDirection as Node<'vec3'>;
    const lightColor = data.lightColor as Node<'vec3'>;
    const reflected = data.reflectedLight.directDiffuse as Node<'vec3'>;
    const facing = normalView.dot(lightDirection).clamp();
    const observed = lightDirection.dot(positionViewDirection).clamp();
    const lobe = exp(float(1).sub(observed).mul(-RETRO.sharpness));
    const lit = lightColor.mul(facing).mul(lobe).mul(this.sheeting).mul(RETRO.gain);
    const boost = float(LIGHT_MAX).mul(float(1).sub(exp(lit.div(-LIGHT_MAX))));
    reflected.addAssign(boost.mul(diffuseColor.rgb));
  }
}

export class RetroNodeMaterial extends MeshLambertNodeMaterial {
  static override get type(): string {
    return 'RetroNodeMaterial';
  }

  constructor(parameters?: ConstructorParameters<typeof MeshLambertNodeMaterial>[0]) {
    super(parameters);
    this.emissiveNode = attribute<'vec3'>(EMIT_ATTRIBUTE).toVar(EMIT_SHADER_MARKER);
  }

  override setupLightingModel(): PhongLightingModel {
    return new RetroLightingModel();
  }
}

/** The retro material on a box under a spot light: the program the props build at night, graded where the preset grades. */
export function retroLitSample(graded = true): GradeSample {
  const geometry = withEmit(withRetro(new BoxGeometry(), 1), [1, 1, 1]);
  geometry.setAttribute('color', new Float32BufferAttribute(new Float32Array(24 * 3), 3));
  const material = new RetroNodeMaterial({ vertexColors: true });
  if (graded) setGraded(material, true);
  const light = new SpotLight(0xffffff, 1, BEAM.distance, BEAM.angle, BEAM.penumbra, 2);
  return {
    mesh: new Mesh(geometry, material),
    lights: [light],
    markers: graded
      ? [RETRO_SHADER_MARKER, EMIT_SHADER_MARKER, GRADE_SHADER_MARKER]
      : [RETRO_SHADER_MARKER, EMIT_SHADER_MARKER],
    dispose: () => {
      light.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}

export type RetroVerdict = 'pending' | 'ok' | 'failed';

/**
 * Whether the reflector program builds on the live renderer, graded or not: three swaps a material
 * whose node graph throws for a plain one and only logs it, and the grade's own check runs on the
 * graded presets alone. The props keep the plain lit material where it fails.
 */
export interface RetroCheck {
  attach(gpu: WebGPURenderer): void;
  /** The verdict for the attached renderer; the first call starts the build. */
  verdict(): RetroVerdict;
  onChange(listener: () => void): () => void;
  dispose(): void;
}

export function createRetroCheck(
  compiles: (gpu: WebGPURenderer) => Promise<void> = (gpu) =>
    precompileSamples(gpu, [() => retroLitSample(false)]),
): RetroCheck {
  let renderer: WebGPURenderer | null = null;
  let state: RetroVerdict | null = null;
  const listeners = new Set<() => void>();
  const settle = (gpu: WebGPURenderer, ok: boolean): void => {
    // a stale request, or a build on a lost context, which passes vacuously
    if (renderer !== gpu || state !== 'pending') return;
    if (gpuLost(gpu)) {
      state = null;
      return;
    }
    state = ok ? 'ok' : 'failed';
    for (const listener of [...listeners]) listener();
  };
  return {
    attach(gpu) {
      if (gpu === renderer) return;
      renderer = gpu;
      state = null;
    },
    verdict() {
      const gpu = renderer;
      if (gpu === null) return 'pending';
      if (state !== null) return state;
      state = 'pending';
      compiles(gpu).then(
        () => settle(gpu, true),
        (error: unknown) => {
          console.warn('Reflector shader failed; keeping the plain props', error);
          settle(gpu, false);
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
      state = null;
      listeners.clear();
    },
  };
}
