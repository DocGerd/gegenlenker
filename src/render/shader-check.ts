import type { Camera, Mesh, Scene } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { countSamplers } from './ground-pbr-spec';
import { gpuLost } from './seams';

/*
 * The shader check every precompile shares. three swaps a material whose node graph throws for a
 * plain one and only logs it, so a build must carry its markers. On WebGPU, WGSL the GPU rejects
 * still comes back as text and only the draw fails: its error is uncaptured and names no feature,
 * so the check validates the WGSL of each build itself, in a scope of its own.
 */

/** A shader the GPU rejected; the same build fails again, so no retry. */
export class ShaderRejectedError extends Error {}

/** The longest a WGSL validation may take before it is inconclusive: no verdict, not a failure. */
export const WGSL_TIMEOUT_MS = 10_000;

const compiling = new WeakMap<WebGPURenderer, Promise<unknown>>();

/**
 * Runs `build` after every earlier one on `gpu` has settled. three's `compileAsync` keeps one
 * precompilation state per renderer, so two overlapping shader builds break each other. Hold only
 * `compileShader` in a turn: the WGSL validation (`verifyWgsl`) can stall and belongs outside.
 */
export function buildSerially<T>(gpu: WebGPURenderer, build: () => Promise<T>): Promise<T> {
  const turn = (compiling.get(gpu) ?? Promise.resolve()).then(build);
  compiling.set(
    gpu,
    turn.catch(() => undefined),
  );
  return turn;
}

/** A built shader pair. */
export interface Compiled {
  readonly vertex: string | null;
  readonly fragment: string | null;
}

/** Builds the program of `mesh` in `scene`. Call it inside `buildSerially`. */
export async function compileShader(
  gpu: WebGPURenderer,
  scene: Scene,
  camera: Camera,
  mesh: Mesh,
): Promise<Compiled> {
  const { fragmentShader, vertexShader } = await gpu.debug.getShaderAsync(scene, camera, mesh);
  return { vertex: vertexShader ?? null, fragment: fragmentShader ?? null };
}

export interface ShaderSpec {
  /** Names the shader in errors, e.g. `the ground shader`. */
  readonly subject: string;
  /** What its fragment shader must hold. */
  readonly markers: readonly string[];
  /** The most samplers its fragment shader may declare. */
  readonly maxSamplers?: number;
}

/** Throws unless the build carries the markers and stays within the samplers. */
export function checkCompiled(
  { fragment }: Compiled,
  { subject, markers, maxSamplers }: ShaderSpec,
): void {
  if (!markers.every((marker) => fragment?.includes(marker) === true)) {
    throw new Error(`${subject} did not build`);
  }
  const samplers = countSamplers(fragment ?? '');
  if (maxSamplers !== undefined && samplers > maxSamplers) {
    throw new Error(`${subject} declares ${String(samplers)} samplers`);
  }
}

/** The WGSL of `code` as the device validates it, null when it is valid or no verdict came in time. */
async function wgslError(device: GPUDevice, code: string): Promise<string | null> {
  // push, create and pop in one turn: no other scope can open between them
  device.pushErrorScope('validation');
  device.createShaderModule({ code });
  const popped = device.popErrorScope();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const inconclusive = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      resolve(null);
    }, WGSL_TIMEOUT_MS);
  });
  try {
    return (await Promise.race([popped, inconclusive]))?.message ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Throws a `ShaderRejectedError` when the device rejects the WGSL of a build. Run it outside
 * `buildSerially`. Creating a module again surfaces no pipeline or limit error, hence the sampler
 * count of `checkCompiled`. Nothing to check on WebGL 2, on a lost device, or without a device.
 */
export async function verifyWgsl(gpu: WebGPURenderer, built: readonly Compiled[]): Promise<void> {
  const device = (gpu.backend as { device?: GPUDevice } | undefined)?.device;
  if (device === undefined || gpuLost(gpu)) return;
  const sources = built.flatMap(({ vertex, fragment }) => [vertex, fragment]);
  const errors = await Promise.all(
    sources.map(async (code) =>
      code === null || code === '' ? null : await wgslError(device, code),
    ),
  );
  const error = errors.find((message): message is string => message !== null);
  if (error !== undefined) throw new ShaderRejectedError(`the GPU rejected the WGSL: ${error}`);
}

/** Whether the WGSL of `built` is accepted; a rejection warns under `what`. */
export async function wgslAccepted(
  gpu: WebGPURenderer,
  built: Compiled,
  what: string,
): Promise<boolean> {
  try {
    await verifyWgsl(gpu, [built]);
    return true;
  } catch (error) {
    console.warn(`${what} failed`, error);
    return false;
  }
}

/** Builds `mesh`'s program on `gpu` and returns its fragment shader; throws unless `spec` holds. */
export async function verifyShader(
  gpu: WebGPURenderer,
  scene: Scene,
  camera: Camera,
  mesh: Mesh,
  spec: ShaderSpec,
): Promise<string> {
  const built = await buildSerially(gpu, () => compileShader(gpu, scene, camera, mesh));
  checkCompiled(built, spec);
  await verifyWgsl(gpu, [built]);
  return built.fragment ?? '';
}

export interface ShaderErrorWatch {
  /** Whether a failed program is the one watched, by its fragment source. */
  readonly matches: (fragmentSource: string | null) => boolean;
  /** Runs for a watched program; `logs` reads the vertex, fragment and program info logs. */
  readonly onMatch: (logs: () => (string | null)[]) => void;
  /** Also pass a watched program to the hook already in place. */
  readonly forward?: boolean;
  /** Prefix of the console error for a program nobody else reports. */
  readonly unwatchedLabel: string;
}

/**
 * Hooks the WebGL 2 backend's `onShaderError`, which only that backend calls. three skips its own
 * report once the hook is set, so an unwatched program goes to the previous hook or the console.
 * Returns the restore, which leaves a hook another asset chained on top of this one alone.
 */
export function watchShaderErrors(
  gpu: WebGPURenderer,
  { matches, onMatch, forward = false, unwatchedLabel }: ShaderErrorWatch,
): () => void {
  const { debug } = gpu;
  const previous = debug.onShaderError;
  const watcher: NonNullable<typeof previous> = (context, program, vertex, fragment) => {
    const logs = (): (string | null)[] => [
      context.getShaderInfoLog(vertex),
      context.getShaderInfoLog(fragment),
      context.getProgramInfoLog(program),
    ];
    const watched = matches(context.getShaderSource(fragment));
    if (watched) onMatch(logs);
    if (watched && !forward) return;
    if (previous !== null) previous(context, program, vertex, fragment);
    else console.error(unwatchedLabel, ...logs());
  };
  debug.onShaderError = watcher;
  return () => {
    if (debug.onShaderError === watcher) debug.onShaderError = previous;
  };
}
