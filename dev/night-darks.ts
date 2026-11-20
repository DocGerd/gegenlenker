import '../src/styles/fonts';
import '../src/styles/tokens.css';
import '../src/styles/base.css';
import {
  Light,
  LinearFilter,
  LinearSRGBColorSpace,
  Material,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  RenderTarget,
  RGBAFormat,
  Scene,
  SRGBColorSpace,
  UnsignedByteType,
  type Object3D,
} from 'three';
import {
  dot,
  float,
  fract,
  output,
  screenCoordinate,
  texture,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import {
  MeshBasicNodeMaterial,
  MeshLambertMaterial,
  MeshLambertNodeMaterial,
  RenderPipeline,
  WebGPURenderer,
  type Node,
  type NodeMaterial,
} from 'three/webgpu';
import { layouts } from '../src/content/registry';
import { resolveLayout } from '../src/content/resolve-layout';
import { proceduralEnvironment } from '../src/render/environment';
import { requestGpuDevice } from '../src/render/gpu-backend';
import { GRADE } from '../src/render/grade';
import { startGroundPbrTextures } from '../src/render/ground-pbr';
import { startGroundTextures } from '../src/render/ground-texture';
import { readScenePalette } from '../src/render/palette';
import { QUALITY_FLAGS, type QualityFlags } from '../src/render/quality';
import { enableLayers, PERSPECTIVE_LAYER, type Environment } from '../src/render/seams';

/*
 * Night darks spike (#201): which 8-bit intermediate keeps the dark tones of a night look.
 * `today` is the app's pipeline (three's own linear 8-bit frame target, encoded by its output pass);
 * `srgb` renders into an sRGB-encoded 8-bit multisample target and encodes the canvas with a
 * RenderPipeline output pass; `dither` is `today` with triangular noise of one linear 8-bit step
 * added before the quantisation. The ground scenes are the real environment at the High and
 * Balanced flags (no shadows, no HDRI), lit, hazed and exposed by `night` times the day light.
 * Query: `scene=ramp|balanced|high`, `mode=today|srgb|dither`, `backend=webgl2|webgpu`,
 * `night=<light share>`, `exposure=<grade exposure>`, `samples=<target samples>`,
 * `rt=linear` (the `srgb` pipeline with a linear target, as a control), `trace=1` (GL call counts).
 * Driven through `window.__nightDarks.run`; the report is also written to `#result`.
 */

type SceneName = 'ramp' | 'balanced' | 'high';
type Mode = 'today' | 'srgb' | 'dither';
const MODES: readonly Mode[] = ['today', 'srgb', 'dither'];

const WIDTH = 1024;
const HEIGHT = 576;

/** Linear value at the right edge of the ramp. */
const RAMP_MAX = 0.05;
/** Share of the day light (and of `exposure`) a night-ish ground is lit by. */
const DEFAULT_NIGHT = 0.02;
/** Rows of the ground frame above this share are sky and skyline. */
const GROUND_FROM = 0.3;
const TIMED_FRAMES = 20;
const WARM_FRAMES = 4;
const CAMERA_HEIGHT = 6;
const CAMERA_LOOK_AHEAD = 14;
const BRIGHTEN = 4;

const stage = document.querySelector<HTMLElement>('#stage');
if (!stage) throw new Error('harness markup missing');
const query = new URLSearchParams(location.search);

const canvas = document.createElement('canvas');
canvas.style.cssText = `width:${WIDTH}px;height:${HEIGHT}px;display:block`;
stage.append(canvas);
const log = document.createElement('pre');
log.id = 'result';
stage.append(log);

const offer = await requestGpuDevice(query.get('backend') === 'webgpu' ? 'webgpu' : 'webgl2');
const renderer = new WebGPURenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
  ...(offer.device === null ? { forceWebGL: true } : { device: offer.device }),
  outputBufferType: UnsignedByteType,
});
await renderer.init();
renderer.setPixelRatio(1);
renderer.setSize(WIDTH, HEIGHT, false);
renderer.info.autoReset = false;

const isWebgl = (renderer.backend as { isWebGLBackend?: boolean }).isWebGLBackend === true;
const gl = isWebgl ? (renderer.getContext() as WebGL2RenderingContext) : null;

const counts = {
  calls: new Map<string, number>(),
  draws: 0,
  blits: 0,
  frameTargets: 0,
  msaaStorage: [] as string[],
};
if (gl !== null) {
  if (query.get('trace') === '1') {
    for (const name of Object.getOwnPropertyNames(WebGL2RenderingContext.prototype)) {
      if (typeof Reflect.get(gl, name) !== 'function' || name === 'getError') continue;
      const original = Reflect.get(gl, name) as (...args: unknown[]) => unknown;
      Reflect.set(gl, name, (...args: unknown[]) => {
        counts.calls.set(name, (counts.calls.get(name) ?? 0) + 1);
        return original.apply(gl, args);
      });
    }
  }
  const wrap = (name: string, onCall: (args: unknown[]) => void): void => {
    const original = Reflect.get(gl, name) as (...args: unknown[]) => unknown;
    Reflect.set(gl, name, (...args: unknown[]) => {
      onCall(args);
      return original.apply(gl, args);
    });
  };
  for (const name of [
    'drawArrays',
    'drawElements',
    'drawArraysInstanced',
    'drawElementsInstanced',
  ]) {
    wrap(name, () => {
      counts.draws++;
    });
  }
  wrap('blitFramebuffer', () => {
    counts.blits++;
  });
  wrap('renderbufferStorageMultisample', (args) => {
    const [, samples, format] = args as [number, number, number];
    const name =
      format === gl.SRGB8_ALPHA8 ? 'SRGB8_ALPHA8' : format === gl.RGBA8 ? 'RGBA8' : String(format);
    counts.msaaStorage.push(`${name}x${String(samples)}`);
  });
}
{
  const target = renderer as unknown as { _getFrameBufferTarget: () => unknown };
  const original = target._getFrameBufferTarget.bind(renderer);
  target._getFrameBufferTarget = () => {
    const made = original();
    if (made !== null) counts.frameTargets++;
    return made;
  };
}

const sync = (): Promise<void> => {
  if (isWebgl) return Promise.resolve();
  return (renderer.backend as unknown as { device: GPUDevice }).device.queue.onSubmittedWorkDone();
};

/** Triangular noise of one step, from two interleaved-gradient samples. */
const noise = (): Node<'float'> => {
  const gradient = (p: Node<'vec2'>): Node<'float'> =>
    fract(float(52.9829189).mul(fract(dot(p, vec2(0.06711056, 0.00583715)))));
  return gradient(screenCoordinate)
    .add(gradient(screenCoordinate.add(vec2(5.588, 5.588))))
    .sub(1);
};
const dithered = (source: Node<'vec4'>): Node<'vec4'> =>
  vec4(source.rgb.add(noise().mul(1 / 255)), source.a);

type Subject = {
  readonly scene: Scene;
  readonly camera: OrthographicCamera | PerspectiveCamera;
  /** The row above which the frame is not scored. */
  readonly scoreFrom: number;
  setDither(on: boolean): void;
  dispose(): void;
};

function rampSubject(): Subject {
  const ramp = vec4(vec3(uv().x.mul(RAMP_MAX)), 1);
  const plain = new MeshBasicNodeMaterial();
  plain.outputNode = ramp;
  const noisy = new MeshBasicNodeMaterial();
  noisy.outputNode = dithered(ramp);
  const geometry = new PlaneGeometry(2, 2);
  const mesh = new Mesh(geometry, plain);
  const scene = new Scene();
  scene.add(mesh);
  return {
    scene,
    camera: new OrthographicCamera(-1, 1, 1, -1, 0, 1),
    scoreFrom: 0,
    setDither(on) {
      mesh.material = on ? noisy : plain;
    },
    dispose() {
      plain.dispose();
      noisy.dispose();
      geometry.dispose();
    },
  };
}

/** The material `base` draws with when its output is dithered; plain Lambert stands in for a graded one. */
function ditheredCopy(base: Material): NodeMaterial | null {
  if (base instanceof MeshLambertMaterial) {
    const copy = new MeshLambertNodeMaterial({ vertexColors: base.vertexColors });
    copy.color.copy(base.color);
    copy.outputNode = dithered(output);
    return copy;
  }
  if ('isNodeMaterial' in base) {
    const node = base as NodeMaterial;
    const copy = node.clone();
    copy.outputNode = dithered((node.outputNode ?? output) as Node<'vec4'>);
    return copy;
  }
  return null;
}

function meshesOf(root: Object3D): Mesh[] {
  const found: Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh && !Array.isArray(o.material)) found.push(o as Mesh);
  });
  return found;
}

async function groundSubject(name: 'balanced' | 'high', share: number): Promise<Subject> {
  const flags: QualityFlags = {
    ...QUALITY_FLAGS[name],
    sunShadow: false,
    hdriSky: false,
  };
  const exposure = Number(query.get('exposure') ?? 1);
  const layout = layouts.depot;
  const resolved = resolveLayout(layout, null);
  const states = { ground: null as string | null, pbr: null as string | null };
  const groundTextures = startGroundTextures(undefined, (s) => {
    states.ground = s;
  });
  const groundPbr = startGroundPbrTextures(undefined, (s) => {
    states.pbr = s;
  });
  groundTextures.attach(renderer);
  groundPbr.attach(renderer);
  const environment: Environment = proceduralEnvironment(
    resolved,
    readScenePalette(),
    groundTextures,
    undefined,
    groundPbr,
  );
  groundTextures.setEnabled(flags.groundTexture);
  groundPbr.setEnabled(flags.groundTexture && flags.groundPbr);
  environment.setQuality(flags);
  if (flags.groundTexture) {
    const deadline = performance.now() + 60_000;
    while (states.ground === null || (flags.groundPbr && states.pbr === null)) {
      if (performance.now() > deadline) throw new Error('ground textures did not apply');
      await new Promise((r) => setTimeout(r, 100));
    }
    if (states.ground === 'failed' || states.pbr === 'failed') throw new Error('ground failed');
  }
  GRADE.exposure.value = exposure;
  environment.object.traverse((o) => {
    if (o instanceof Light) o.intensity *= share;
  });
  // the haze is scene light too: left at its day value it would lift the darks the harness looks at
  GRADE.hazeToward.value.multiplyScalar(share);
  GRADE.hazeAway.value.multiplyScalar(share);

  const scene = new Scene();
  scene.add(environment.object);
  const { start } = layout;
  const camera = new PerspectiveCamera(60, WIDTH / HEIGHT, 0.1, 400);
  enableLayers(camera.layers, [PERSPECTIVE_LAYER]);
  const dx = Math.cos(start.heading);
  const dz = -Math.sin(start.heading);
  camera.position.set(start.x, CAMERA_HEIGHT, -start.y);
  camera.lookAt(start.x + dx * CAMERA_LOOK_AHEAD, 0, -start.y + dz * CAMERA_LOOK_AHEAD);
  scene.updateMatrixWorld(true);

  const meshes = meshesOf(environment.object);
  const originals = new Map(meshes.map((m) => [m, m.material as Material]));
  const copies = new Map<Material, NodeMaterial | null>();
  return {
    scene,
    camera,
    scoreFrom: GROUND_FROM,
    setDither(on) {
      for (const [mesh, base] of originals) {
        if (!on) {
          mesh.material = base;
          continue;
        }
        if (!copies.has(base)) copies.set(base, ditheredCopy(base));
        mesh.material = copies.get(base) ?? base;
      }
    },
    dispose() {
      for (const copy of copies.values()) copy?.dispose();
      environment.dispose();
      groundTextures.dispose();
      groundPbr.dispose();
    },
  };
}

const samples = Number(query.get('samples') ?? 4);
const target = new RenderTarget(WIDTH, HEIGHT, {
  type: UnsignedByteType,
  format: RGBAFormat,
  colorSpace: query.get('rt') === 'linear' ? LinearSRGBColorSpace : SRGBColorSpace,
  samples,
  depthBuffer: true,
  minFilter: NearestFilter,
  magFilter: LinearFilter,
  generateMipmaps: false,
});
// the output pass's own render sets the renderer to the working space, so three draws it to the canvas directly
const pipeline = new RenderPipeline(renderer, texture(target.texture));

function frame(subject: Subject, mode: Mode): void {
  if (mode === 'srgb') {
    renderer.setRenderTarget(target);
    renderer.render(subject.scene, subject.camera);
    renderer.setRenderTarget(null);
    pipeline.render();
  } else {
    renderer.render(subject.scene, subject.camera);
  }
}

const copy = document.createElement('canvas');
copy.width = WIDTH;
copy.height = HEIGHT;
const context2d = copy.getContext('2d', { willReadFrequently: true });
if (context2d === null) throw new Error('no 2d context');
const copyContext: CanvasRenderingContext2D = context2d;

/** Copies the canvas; must run in the task that drew it. */
function readCanvas(): ImageData {
  copyContext.clearRect(0, 0, WIDTH, HEIGHT);
  copyContext.drawImage(canvas, 0, 0);
  return copyContext.getImageData(0, 0, WIDTH, HEIGHT);
}

const srgbToLinear = (code: number): number => {
  const c = code / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const linearToSrgbCode = (v: number): number => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return c * 255;
};

function hash(data: Uint8ClampedArray): string {
  let h = 0x811c9dc5;
  for (const byte of data) h = Math.imul(h ^ byte, 0x01000193) >>> 0;
  return h.toString(16);
}

type Scores = {
  /** Distinct red codes in the scored rows (the ramp: in the middle row). */
  distinctCodes: number;
  /** Mean luma code of the scored rows. */
  meanCode: number;
  /** Ramp only: mean error, in output codes, of the column mean over all rows against the ideal encode. */
  rampErrorCodes?: number;
  /** Ramp only: highest output code. */
  rampTopCode?: number;
};

function score(image: ImageData, scene: SceneName, scoreFrom: number): Scores {
  const { data } = image;
  const at = (x: number, y: number): number => (y * WIDTH + x) * 4;
  if (scene === 'ramp') {
    const middle = new Set<number>();
    let error = 0;
    let top = 0;
    for (let x = 0; x < WIDTH; x++) {
      let sum = 0;
      for (let y = 0; y < HEIGHT; y++) sum += data[at(x, y)] ?? 0;
      const mean = sum / HEIGHT;
      const ideal = linearToSrgbCode(((x + 0.5) / WIDTH) * RAMP_MAX);
      error += Math.abs(mean - ideal);
      const code = data[at(x, HEIGHT >> 1)] ?? 0;
      middle.add(code);
      top = Math.max(top, code);
    }
    return {
      distinctCodes: middle.size,
      meanCode: 0,
      rampErrorCodes: error / WIDTH,
      rampTopCode: top,
    };
  }
  const codes = new Set<number>();
  let sum = 0;
  let n = 0;
  for (let y = Math.floor(HEIGHT * scoreFrom); y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = at(x, y);
      const luma = Math.round(
        0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0),
      );
      codes.add(luma);
      sum += luma;
      n++;
    }
  }
  return { distinctCodes: codes.size, meanCode: sum / n };
}

const median = (xs: number[]): number => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[sorted.length >> 1] ?? 0;
};

function boosted(image: ImageData): string {
  const lifted = new ImageData(WIDTH, HEIGHT);
  for (let i = 0; i < image.data.length; i++) {
    lifted.data[i] = i % 4 === 3 ? 255 : Math.min(255, (image.data[i] ?? 0) * BRIGHTEN);
  }
  copyContext.putImageData(lifted, 0, 0);
  return copy.toDataURL('image/png');
}

export type Report = {
  scene: SceneName;
  mode: Mode;
  backend: 'webgl2' | 'webgpu';
  glRenderer: string | null;
  scores: Scores;
  /** `renderer.info` draw calls of one frame. */
  drawCalls: number;
  /** GL draw commands of one frame (WebGL 2 only). */
  glDraws: number | null;
  blits: number | null;
  /** Times three handed out its internal frame target in one frame. */
  frameTargetUses: number;
  /** Multisample renderbuffer storage allocated during the whole run so far (WebGL 2 only). */
  msaaStorage: string[];
  msaaSupport: Record<string, number[]> | null;
  glError: number | null;
  /** Every GL call of one frame, with `?trace=1`. */
  glCalls: Record<string, number>;
  medianMs: number | null;
  /** Hash of the canvas on each of `repeat` frames. */
  hashes: string[];
  png?: string;
  pngBoosted?: string;
  /** The ground's mean linear luma, when it is a ground. */
  meanLinear: number | null;
};

export type RunOptions = {
  repeat?: number;
  timed?: boolean;
  images?: boolean;
};

let subject: { name: SceneName; share: number; value: Subject } | null = null;

async function useScene(name: SceneName, share: number): Promise<Subject> {
  if (subject?.name === name && subject.share === share) return subject.value;
  subject?.value.dispose();
  subject = null;
  const value = name === 'ramp' ? rampSubject() : await groundSubject(name, share);
  subject = { name, share, value };
  return value;
}

function samplesOf(context: WebGL2RenderingContext, format: number): number[] {
  const samples = context.getInternalformatParameter(
    context.RENDERBUFFER,
    format,
    context.SAMPLES,
  ) as Int32Array;
  return [...samples];
}

function glRendererName(): string | null {
  if (gl === null) return null;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const name: unknown = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : undefined;
  return typeof name === 'string' ? name : null;
}

async function run(
  name: SceneName,
  mode: Mode,
  { repeat = 1, timed = false, images = false }: RunOptions = {},
): Promise<Report> {
  const share = Number(query.get('night') ?? DEFAULT_NIGHT);
  const current = await useScene(name, share);
  current.setDither(mode === 'dither');
  for (let i = 0; i < WARM_FRAMES; i++) frame(current, mode);
  await sync();
  gl?.getError();

  const hashes: string[] = [];
  let image = new ImageData(1, 1);
  let drawCalls = 0;
  let glDraws: number | null = null;
  let blits: number | null = null;
  let frameTargetUses = 0;
  for (let i = 0; i < repeat; i++) {
    renderer.info.reset();
    counts.draws = 0;
    counts.blits = 0;
    counts.frameTargets = 0;
    counts.calls.clear();
    frame(current, mode);
    image = readCanvas();
    hashes.push(hash(image.data));
    drawCalls = renderer.info.render.drawCalls;
    glDraws = gl === null ? null : counts.draws;
    blits = gl === null ? null : counts.blits;
    frameTargetUses = counts.frameTargets;
  }
  const glError = gl === null ? null : gl.getError();

  let medianMs: number | null = null;
  if (timed) {
    const times: number[] = [];
    for (let i = 0; i < TIMED_FRAMES; i++) {
      const t0 = performance.now();
      frame(current, mode);
      copyContext.drawImage(canvas, 0, 0);
      copyContext.getImageData(0, 0, 1, 1);
      await sync();
      times.push(performance.now() - t0);
    }
    medianMs = median(times);
  }

  const scores = score(image, name, current.scoreFrom);
  const report: Report = {
    scene: name,
    mode,
    backend: isWebgl ? 'webgl2' : 'webgpu',
    glRenderer: glRendererName(),
    scores,
    drawCalls,
    glDraws,
    blits,
    frameTargetUses,
    msaaStorage: [...new Set(counts.msaaStorage)],
    msaaSupport:
      gl === null
        ? null
        : { SRGB8_ALPHA8: samplesOf(gl, gl.SRGB8_ALPHA8), RGBA8: samplesOf(gl, gl.RGBA8) },
    glError,
    glCalls: Object.fromEntries(counts.calls),
    medianMs,
    hashes,
    meanLinear: name === 'ramp' ? null : srgbToLinear(scores.meanCode),
  };
  if (images) {
    copyContext.putImageData(image, 0, 0);
    report.png = copy.toDataURL('image/png');
    report.pngBoosted = boosted(image);
  }
  return report;
}

declare global {
  interface Window {
    __nightDarks?: { modes: readonly Mode[]; run: typeof run };
  }
}
window.__nightDarks = { modes: MODES, run };

const sceneParam = query.get('scene');
const modeParam = query.get('mode');
const scene: SceneName = sceneParam === 'balanced' || sceneParam === 'high' ? sceneParam : 'ramp';
const mode: Mode = modeParam === 'srgb' || modeParam === 'dither' ? modeParam : 'today';
const first = await run(scene, mode);
log.textContent = JSON.stringify(first, null, 2);
document.documentElement.dataset['nightDarks'] = 'ready';
