import {
  BoxGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  type Light,
  type Material,
  Mesh,
  PerspectiveCamera,
  Scene,
  Vector3,
} from 'three';
import {
  cameraPosition,
  dot,
  exp,
  float,
  max,
  mix,
  normalize,
  output,
  positionWorld,
  select,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import {
  MeshLambertNodeMaterial,
  type Node,
  type NodeMaterial,
  type WebGPURenderer,
} from 'three/webgpu';
import { gpuLost } from './seams';

/*
 * The perspective grade: aerial perspective, then tone mapping, inside each
 * perspective-only lit material. The renderer stays at NoToneMapping, which would also grade the
 * top-down view and the unlit cockpit. The uniforms are shared, so night (N2) switches them once.
 */

/** Extinction (1/m) of the aerial-perspective fog: a few per cent across the yard, a fifth at the far plane. */
export const FOG_DENSITY = 0.0006;
/** Height (m) over which the fog thins by e. */
const FOG_HEIGHT = 60;

export const GRADE = {
  exposure: uniform(1),
  /** 0 switches the fog off without a shader change. */
  fogDensity: uniform(0),
  hazeToward: uniform(new Color()),
  hazeAway: uniform(new Color()),
  /** Share of the HDRI in a sky dome that has one; night fades it out. */
  skyHdri: uniform(1),
  /** Unit vector towards the perspective sun: the haze is warmer on that side. */
  sunDirection: uniform(new Vector3(0, 1, 0)),
  /** Share of the light the cab interior's albedo takes: the dash lamps and night dim it. */
  interiorLight: uniform(1),
};

/** Share of the fog colour at this fragment. */
export function fogFactor(): Node<'float'> {
  const offset = positionWorld.sub(cameraPosition);
  const thin = exp(max(positionWorld.y, 0).div(-FOG_HEIGHT));
  return float(1)
    .sub(exp(offset.length().mul(GRADE.fogDensity).negate()))
    .mul(thin);
}

/** The haze colour seen along this fragment's view ray. */
export function hazeColour(): Node<'vec3'> {
  const view = normalize(positionWorld.sub(cameraPosition));
  const toward = dot(view, GRADE.sunDirection).mul(0.5).add(0.5);
  return mix(GRADE.hazeAway, GRADE.hazeToward, toward);
}

/** Named in the generated shader, so a graded material can be told from a plain one. */
export const GRADE_SHADER_MARKER = 'perspectiveGrade';

/** Khronos PBR Neutral: highlights roll off from here, darker colours pass unchanged. */
const COMPRESSION_START = 0.76;
const DESATURATION = 0.15;
const COMPRESSION_RANGE = 1 - COMPRESSION_START;

/**
 * Khronos PBR Neutral without its toe: the toe offsets the F0 = 0.04 of a full PBR material, but
 * these are Lambert, and it would crush the dark tones next to the ungraded layer-0 tokens.
 */
export function toneMap(color: Node<'vec3'>): Node<'vec3'> {
  const c = color.mul(GRADE.exposure);
  const peak = max(c.r, max(c.g, c.b));
  const over = max(peak, COMPRESSION_START);
  const newPeak = float(1).sub(
    float(COMPRESSION_RANGE * COMPRESSION_RANGE).div(
      over.add(COMPRESSION_RANGE - COMPRESSION_START),
    ),
  );
  const fade = float(1).sub(float(1).div(over.sub(newPeak).mul(DESATURATION).add(1)));
  const compressed = mix(c.mul(newPeak.div(over)), vec3(newPeak), fade);
  return select(peak.lessThan(COMPRESSION_START), c, compressed);
}

export type Rgb = readonly [number, number, number];

/** `toneMap` on the CPU, from the same constants; the tests pin the curve here, so change both together. */
export function toneMapRgb(color: Rgb, exposure = GRADE.exposure.value): Rgb {
  const c: Rgb = [color[0] * exposure, color[1] * exposure, color[2] * exposure];
  const peak = Math.max(...c);
  if (peak < COMPRESSION_START) return c;
  const newPeak =
    1 - (COMPRESSION_RANGE * COMPRESSION_RANGE) / (peak + COMPRESSION_RANGE - COMPRESSION_START);
  const fade = 1 - 1 / ((peak - newPeak) * DESATURATION + 1);
  const scale = newPeak / peak;
  const tone = (v: number): number => v * scale * (1 - fade) + newPeak * fade;
  return [tone(c[0]), tone(c[1]), tone(c[2])];
}

/** Fog, then tone mapping, of a linear scene colour. */
export const graded = (color: Node<'vec3'>): Node<'vec3'> =>
  toneMap(mix(color, hazeColour(), fogFactor())).toVar(GRADE_SHADER_MARKER);

type Entry = {
  base: Node<'vec4'> | null;
  /** The graded output; unset, it is the default grade of `base` (or of the material's own `output`). */
  grade: Node<'vec4'> | null;
  wanted: boolean;
  applied: boolean;
};

const entries = new Map<NodeMaterial, Entry>();
/** Set when the grade failed on this renderer: every graded material shows its plain output. */
let disabled = false;

function sync(material: NodeMaterial, entry: Entry): void {
  const on = entry.wanted && !disabled;
  if (entry.applied === on) return;
  entry.applied = on;
  if (on && entry.grade === null) {
    const source = entry.base ?? output;
    entry.grade = vec4(graded(source.rgb), source.a);
  }
  material.outputNode = on ? entry.grade : entry.base;
  material.needsUpdate = true;
}

/**
 * Puts the grade on `material`'s output, or takes it off; `base` is the material's own output
 * stage, kept underneath, and `grade` replaces the default grade of it (it must carry
 * `GRADE_SHADER_MARKER`). Recompiles, so call it on a quality change only. While the grade is
 * disabled (`setGradeDisabled`) it applies nothing.
 */
export function setGraded(
  material: NodeMaterial,
  on: boolean,
  base: Node<'vec4'> | null = null,
  grade: Node<'vec4'> | null = null,
): void {
  let entry = entries.get(material);
  if (entry === undefined) {
    entry = { base, grade, wanted: false, applied: false };
    entries.set(material, entry);
    material.addEventListener('dispose', () => entries.delete(material));
  }
  entry.wanted = on;
  sync(material, entry);
}

export const gradeDisabled = (): boolean => disabled;

/** Takes the grade off every graded material and keeps it off, or lets the wanted ones wear it again. */
export function setGradeDisabled(off: boolean): void {
  if (disabled === off) return;
  disabled = off;
  for (const [material, entry] of entries) sync(material, entry);
}

const compiling = new WeakMap<WebGPURenderer, Promise<unknown>>();

/**
 * Runs `build` after every earlier one on `gpu` has settled. three's `compileAsync` keeps one
 * precompilation state per renderer, so two overlapping shader builds break each other.
 */
export function buildSerially<T>(gpu: WebGPURenderer, build: () => Promise<T>): Promise<T> {
  const turn = (compiling.get(gpu) ?? Promise.resolve()).then(build);
  compiling.set(
    gpu,
    turn.catch(() => undefined),
  );
  return turn;
}

/**
 * A mesh the grade check compiles, the lights it is lit by, and what releases it. `override` is the
 * scene's override material, so the sample builds the shadow pass's program; `markers` are the
 * strings its fragment shader must hold (the grade's by default), and GLSL errors in a shader that
 * holds the first of them reject the check.
 */
export type GradeSample = {
  readonly mesh: Mesh;
  readonly lights?: readonly Light[];
  readonly override?: Material;
  readonly markers?: readonly string[];
  dispose(): void;
};

function lambertSample(): GradeSample {
  const geometry = new BoxGeometry();
  geometry.setAttribute('color', new Float32BufferAttribute(new Float32Array(24 * 3), 3));
  const material = new MeshLambertNodeMaterial({ vertexColors: true });
  setGraded(material, true);
  return {
    mesh: new Mesh(geometry, material),
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

/** The graded Lambert material on a shadow receiver under a casting sun: the program the lit views build on High. */
export function shadowReceiverSample(): GradeSample {
  const sample = lambertSample();
  sample.mesh.receiveShadow = true;
  const sun = new DirectionalLight();
  sun.castShadow = true;
  return {
    mesh: sample.mesh,
    lights: [sun],
    dispose: () => {
      sun.shadow.dispose();
      sample.dispose();
    },
  };
}

/**
 * Builds a graded Lambert material, a shadow receiver and every `extra` sample on `gpu`; rejects unless each shader
 * carries the grade marker. three swaps a material whose node graph throws for a plain one and
 * only logs it, and the WebGL 2 backend reports GLSL errors through a hook only.
 */
export function precompileGrade(
  gpu: WebGPURenderer,
  extra: readonly (() => GradeSample)[] = [],
): Promise<void> {
  return buildSerially(gpu, () => buildGrade(gpu, extra));
}

async function buildGrade(
  gpu: WebGPURenderer,
  extra: readonly (() => GradeSample)[],
): Promise<void> {
  const samples: GradeSample[] = [];
  const { debug } = gpu;
  const previous = debug.onShaderError;
  const rejected: { log: string | null } = { log: null };
  // another asset may have chained its own hook behind this one: pass through once the check is over
  let active = true;
  const watched = new Set([GRADE_SHADER_MARKER]);
  const watcher: NonNullable<typeof previous> = (context, program, vertex, fragment) => {
    const info = [
      context.getShaderInfoLog(vertex),
      context.getShaderInfoLog(fragment),
      context.getProgramInfoLog(program),
    ];
    const source = context.getShaderSource(fragment);
    if (active && source !== null && [...watched].some((marker) => source.includes(marker))) {
      rejected.log = info.join(' ');
    } else if (previous !== null) previous(context, program, vertex, fragment);
    else console.error('Shader error', ...info);
  };
  debug.onShaderError = watcher;
  try {
    for (const make of [lambertSample, shadowReceiverSample, ...extra]) {
      const sample = make();
      samples.push(sample);
      const scene = new Scene();
      scene.add(sample.mesh, ...(sample.lights ?? []));
      if (sample.override !== undefined) scene.overrideMaterial = sample.override;
      const markers = sample.markers ?? [GRADE_SHADER_MARKER];
      const [first] = markers;
      if (first !== undefined) watched.add(first);
      const { fragmentShader } = await debug.getShaderAsync(
        scene,
        new PerspectiveCamera(),
        sample.mesh,
      );
      if (!markers.every((marker) => fragmentShader?.includes(marker) === true)) {
        throw new Error('a graded shader did not build');
      }
    }
    if (rejected.log !== null) {
      throw new Error(`a graded shader failed to compile: ${rejected.log}`);
    }
  } finally {
    active = false;
    if (debug.onShaderError === watcher) debug.onShaderError = previous;
    for (const sample of samples) sample.dispose();
  }
}

/** `on`: the grade passed its check while the preset grades; `failed`: it is off; null: not graded or not checked yet. */
export type GradeState = 'on' | 'failed' | null;

export interface GradeCheck {
  /** The renderer the check runs on; a different one drops the previous verdict and any failure. */
  attach(gpu: WebGPURenderer): void;
  /** Whether the preset grades; the check runs once per renderer, the first time it does. */
  setWanted(on: boolean): void;
  dispose(): void;
}

export function createGradeCheck(
  onState: (state: GradeState) => void,
  compiles: (gpu: WebGPURenderer) => Promise<void> = (gpu) => precompileGrade(gpu),
): GradeCheck {
  let renderer: WebGPURenderer | null = null;
  let wanted = false;
  let checking = false;
  let verdict: 'ok' | 'failed' | null = null;
  let published: GradeState = null;

  const publish = (): void => {
    const state = !wanted || verdict === null ? null : verdict === 'ok' ? 'on' : 'failed';
    if (state === published) return;
    published = state;
    onState(state);
  };
  const run = (): void => {
    const gpu = renderer;
    if (gpu === null || !wanted || checking || verdict !== null) return;
    checking = true;
    const settle = (failure: unknown): void => {
      if (renderer !== gpu) return;
      checking = false;
      // a check on a lost context passes vacuously or fails for the loss: the replacement checks again
      if (gpuLost(gpu)) return;
      if (failure === null) verdict = 'ok';
      else {
        verdict = 'failed';
        setGradeDisabled(true);
        console.warn('Perspective grade failed; keeping the plain shading', failure);
      }
      publish();
    };
    compiles(gpu).then(
      () => {
        settle(null);
      },
      (error: unknown) => {
        settle(error ?? new Error('rejected'));
      },
    );
  };

  return {
    attach(gpu) {
      if (gpu === renderer) return;
      renderer = gpu;
      checking = false;
      verdict = null;
      setGradeDisabled(false);
      publish();
      run();
    },
    setWanted(on) {
      wanted = on;
      publish();
      run();
    },
    dispose() {
      renderer = null;
      wanted = false;
      checking = false;
      verdict = null;
      setGradeDisabled(false);
      publish();
    },
  };
}
