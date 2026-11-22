import { OrthographicCamera, Scene, Vector3, type Object3D } from 'three';
import { Lighting, WebGPURenderer } from 'three/webgpu';
import type { Rect2, ResolvedLayout } from '../contracts/layout';
import {
  DEFAULT_GRAPHICS,
  DEFAULT_LIGHTING,
  DEFAULT_TOP_DOWN_VIEW,
  GraphicsStartError,
  type GraphicsBackend,
  type GraphicsPreset,
  type LightingMode,
  type Rect,
  type ViewRects,
  type RenderFrame,
  type RenderStats,
  type SceneRenderer,
  type ScenePalette,
  type WebgpuFallback,
} from '../contracts/render';
import type { SimSnapshot } from '../contracts/sim';
import type { TrailerSpec, TruckAnchors, TruckSpec } from '../contracts/vehicle';
import { truckAnchors } from '../vehicles/anchors';
import { resolveCombination } from '../vehicles/resolve';
import { cabFront, createChaseCamera, placeChaseCamera, type CabFront } from './chase-camera';
import { createCockpitCamera, placeCockpitCamera } from './cockpit-camera';
import { followFraming, leadTarget, yardFraming } from './follow-framing';
import { createFrameTimer } from './governor';
import { createFrame, type Frame } from './frame-target';
import { describeAdapter } from './gpu-backend';
import {
  createMirror,
  mirrorAnchor,
  mirrorFacing,
  type MirrorMounts,
  mirrorMounts,
  MIRRORS,
} from './mirror';
import { readScenePalette } from './palette';
import { lookFor } from './look';
import { QUALITY_FLAGS } from './quality';
import {
  AIDS_LAYER,
  enableLayers,
  gpuLost,
  markLost,
  TOP_DOWN_LAYERS,
  type AidsLayer,
  type CockpitInterior,
  type Environment,
  type RendererParts,
  type VehicleVisual,
} from './seams';
import { isShadowCamera } from './sun-shadow';
import { placeTopDownCamera } from './top-down-camera';

const FOLLOW_HALF_HEIGHT = 20;
/** Metres added to the vehicle's bounding radius. */
const FOLLOW_RADIUS_MARGIN = 1;
/** Time constant of the look-ahead shift, so a gear change glides instead of jumping. */
const LEAD_SECONDS = 0.5;
const MAX_LEAD_STEP_SECONDS = 0.25;
const YARD_MARGIN = 5;
const SKY_HEIGHT = 200;

type Built = {
  readonly scene: Scene;
  readonly truck: VehicleVisual;
  readonly trailer: VehicleVisual;
  readonly environment: Environment;
  readonly aids: AidsLayer;
  readonly interior: CockpitInterior;
  readonly anchors: TruckAnchors;
  readonly mounts: MirrorMounts;
  readonly cabFront: CabFront;
  readonly palette: ScenePalette;
  readonly yardBounds: Rect2;
  /** Metres from the follow centre that bound the whole combination. */
  readonly radius: number;
};

/**
 * three keeps one light list per scene and Lighting; the top-down view sees other lights than the
 * perspective ones (light-rig.ts), so a list of its own keeps both, and every cache key, stable.
 */
const topDownLighting = new WeakMap<WebGPURenderer, Lighting>();

/** `rect` in the pane's own px. */
function relativeTo(pane: Rect, rect: Rect): Rect {
  return { x: rect.x - pane.x, y: rect.y - pane.y, width: rect.width, height: rect.height };
}

function fitBounds(layout: ResolvedLayout): Rect2 {
  const fitted = layout.surfaces.filter((s) => s.kind === 'yard' || s.kind === 'street');
  const rects = [layout.yard, ...fitted.map((s) => s.rect)];
  return {
    minX: Math.min(...rects.map((r) => r.minX)) - YARD_MARGIN,
    minY: Math.min(...rects.map((r) => r.minY)) - YARD_MARGIN,
    maxX: Math.max(...rects.map((r) => r.maxX)) + YARD_MARGIN,
    maxY: Math.max(...rects.map((r) => r.maxY)) + YARD_MARGIN,
  };
}

function followRadius(truck: TruckSpec, trailer: TrailerSpec): number {
  const p = resolveCombination(truck, trailer);
  const length =
    p.truckFront + p.couplingOffset + p.drawbar + p.trailerWheelbase + p.trailerRearOverhang;
  return length / 2 + Math.max(p.truckWidth, p.trailerWidth) / 2 + FOLLOW_RADIUS_MARGIN;
}

/** The bumper-to-trailer-rear midpoint the follow views and the sun shadow centre on. */
function vehicleCentre(snapshot: SimSnapshot, frontX: number): { x: number; y: number } {
  const { truck, trailerRear } = snapshot;
  const bumperX = truck.x + Math.cos(truck.heading) * frontX;
  const bumperY = truck.y + Math.sin(truck.heading) * frontX;
  return { x: (bumperX + trailerRear.x) / 2, y: (bumperY + trailerRear.y) / 2 };
}

function setAidsLayer(object: Object3D): void {
  object.traverse((o) => o.layers.set(AIDS_LAYER));
}

/**
 * `dispose` waits for a pending `init`, so a start that failed rejects again here: nothing new to
 * report. three leaves a device it was given alive, so it goes too.
 */
function release(gpu: WebGPURenderer, device: GPUDevice | null, failedStart = false): void {
  gpu
    .dispose()
    .catch((error: unknown) => {
      if (!failedStart) console.warn('Could not release the GPU renderer', error);
    })
    .finally(() => device?.destroy())
    .catch((error: unknown) => console.warn('Could not release the GPU device', error));
}

function hasWebgl2(canvas: HTMLCanvasElement): boolean {
  try {
    return canvas.getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

/**
 * Settles once the GPU renderer can draw: on WebGPU through `device`, else on WebGL 2. Rejects when
 * it cannot start, as unavailable only when WebGL 2 failed for want of a context. `onLost` replaces
 * three's loss handler, which only logs; a loss during `init` rejects instead. `onError` hears
 * WebGPU's uncaptured errors before three logs them.
 */
async function startGpu(
  canvas: HTMLCanvasElement,
  onLost: (gpu: WebGPURenderer) => void,
  onError: () => void,
  device: GPUDevice | null,
): Promise<WebGPURenderer> {
  let gpu: WebGPURenderer | null = null;
  const loss = { started: false, early: false };
  try {
    const own = new WebGPURenderer({
      canvas,
      // the frame target is multisampled; a multisampled canvas would only cost
      antialias: false,
      powerPreference: 'high-performance',
      ...(device === null ? { forceWebGL: true } : { device }),
    });
    gpu = own;
    own.onDeviceLost = () => {
      markLost(own);
      if (loss.started) onLost(own);
      else loss.early = true;
    };
    const report = own.onError;
    own.onError = (info) => {
      onError();
      report.call(own, info);
    };
    await own.init();
  } catch (error) {
    if (gpu !== null) release(gpu, device, true);
    if (device === null && !hasWebgl2(canvas)) {
      throw new GraphicsStartError('unavailable', { cause: error });
    }
    throw error;
  }
  if (loss.early || gpuLost(gpu)) {
    release(gpu, device);
    throw new Error('The GPU context was lost while starting');
  }
  loss.started = true;
  return gpu;
}

/** Whether a clear inside a pass honours the pane's scissor: WebGL 2's does, WebGPU's load op does not. */
const scissoredClear = (backend: GraphicsBackend): boolean => backend === 'webgl2';

const backendOf = (gpu: WebGPURenderer): GraphicsBackend =>
  (gpu.backend as { isWebGLBackend?: boolean }).isWebGLBackend === true ? 'webgl2' : 'webgpu';

function describeGl(gpu: WebGPURenderer): string {
  const gl = gpu.getContext() as WebGL2RenderingContext;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const name: unknown = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : undefined;
  return typeof name === 'string' && name !== '' ? name : 'unknown';
}

/** `warmUp` holds the resolution governor off while something heavy (a shell, the ground texture) attaches. */
export function createThreeSceneRenderer(
  parts: RendererParts,
): SceneRenderer & { warmUp: (tag?: string) => void } {
  const timer = createFrameTimer();
  const cockpitCamera = createCockpitCamera();
  const topDownCamera = new OrthographicCamera(-1, 1, 1, -1, 1, SKY_HEIGHT * 2);
  enableLayers(topDownCamera.layers, TOP_DOWN_LAYERS);
  const chaseCamera = createChaseCamera();
  topDownCamera.rotation.x = -Math.PI / 2;
  topDownCamera.position.y = SKY_HEIGHT;
  let quality = QUALITY_FLAGS[DEFAULT_GRAPHICS];
  let lighting: LightingMode = DEFAULT_LIGHTING;
  const mirrors = MIRRORS.map((spec) => ({
    mirror: createMirror(spec, quality.mirrorMsaa),
    rect: (views: ViewRects): Rect | null => views[spec.view],
  }));
  const mirrorPosition = new Vector3();
  const projected = new Vector3();

  let renderer: WebGPURenderer | null = null;
  let drawing: Frame | null = null;
  /** The device the WebGPU backend draws through; null on WebGL 2. */
  let device: GPUDevice | null = null;
  /** Why WebGPU is not drawing although asked for; once set, later starts go straight to WebGL 2. */
  let fallback: WebgpuFallback | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let built: Built | null = null;
  let cssWidth = 0;
  let cssHeight = 0;
  let appliedRatio = 0;
  let contextLost = false;
  let glRenderer = 'unknown';
  let backend: GraphicsBackend = 'webgl2';
  let drawCalls = 0;
  let shadowPasses = 0;
  let mirrorCalls = 0;
  let frameIndex = 0;
  let topDownRect: Rect | null = null;
  let chaseShown = false;
  const lead = { x: 0, y: 0 };
  let leadAt = -1;
  /** Bumped by every `init` and by `dispose`, so a superseded start drops its renderer. */
  let generation = 0;
  const lostListeners = new Set<() => void>();

  const onLost = (): void => {
    if (contextLost) return;
    contextLost = true;
    for (const listener of [...lostListeners]) listener();
  };
  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') resetTiming('visibility');
  };

  /** A long gap between frames (restore, hidden tab, new scene) must not count as slow rendering. */
  function resetTiming(tag: string): void {
    timer.resetTiming(tag);
    appliedRatio = 0;
  }

  const ratio = (): number =>
    Math.min(window.devicePixelRatio || 1, quality.pixelRatioCap) * timer.scale();

  function applySize(): void {
    if (renderer === null || cssWidth === 0) return;
    const r = ratio();
    renderer.setPixelRatio(r);
    renderer.setSize(cssWidth, cssHeight, false);
    drawing?.resize();
    appliedRatio = r;
  }

  function applyLookTo(b: Built): void {
    const look = lookFor(quality, lighting);
    b.environment.setLook(look);
    b.aids.setLook(look);
    b.truck.setLook(look);
    b.trailer.setLook(look);
    b.interior.setLook(look);
    for (const { mirror } of mirrors) mirror.invalidate();
  }

  function disposeBuilt(): void {
    if (built === null) return;
    built.truck.dispose();
    built.trailer.dispose();
    built.environment.dispose();
    built.aids.dispose();
    built.interior.dispose();
    built.scene.clear();
    built = null;
  }

  function placeTopDown(frame: RenderFrame, rect: Rect, b: Built): void {
    const aspect = rect.width / rect.height;
    let cx: number;
    let cy: number;
    let halfH: number;
    if (frame.topDown === 'follow') {
      const { truck, trailer, speed, control } = frame.snapshot;
      const target = leadTarget(truck.heading, trailer.heading, speed, control.gear);
      const now = performance.now();
      const k =
        leadAt < 0
          ? 1
          : 1 - Math.exp(-Math.min((now - leadAt) / 1000, MAX_LEAD_STEP_SECONDS) / LEAD_SECONDS);
      leadAt = now;
      lead.x += (target.x - lead.x) * k;
      lead.y += (target.y - lead.y) * k;
      const framing = followFraming({
        vehicle: vehicleCentre(frame.snapshot, b.anchors.frontX),
        lead,
        radius: b.radius,
        pane: rect,
        clear: frame.topDownClear ?? rect,
        baseHalf: FOLLOW_HALF_HEIGHT,
      });
      cx = framing.centre.x;
      cy = framing.centre.y;
      halfH = framing.half;
    } else {
      const framing = yardFraming({
        bounds: b.yardBounds,
        pane: rect,
        clear: frame.topDownClear ?? rect,
      });
      cx = framing.centre.x;
      cy = framing.centre.y;
      halfH = framing.half;
    }
    placeTopDownCamera(
      topDownCamera,
      { x: cx, y: cy },
      halfH,
      aspect,
      frame.topDownView ?? DEFAULT_TOP_DOWN_VIEW,
    );
    topDownCamera.updateMatrixWorld();
    topDownRect = rect;
  }

  function releaseGpu(): void {
    if (canvas !== null) {
      // three's loss handler asks the browser to restore this context; a 0x0 canvas keeps that cheap.
      canvas.width = 0;
      canvas.height = 0;
    }
    drawing?.dispose();
    drawing = null;
    if (renderer !== null) release(renderer, device);
    renderer = null;
    device = null;
    canvas = null;
  }

  /** WebGPU first, unless it failed before; a WebGPU start that fails goes on with WebGL 2. */
  async function start(
    target: HTMLCanvasElement,
    mine: number,
  ): Promise<{ gpu: WebGPURenderer; device: GPUDevice | null }> {
    const lost = (gpu: WebGPURenderer): void => {
      // also when the loss came before `renderer` named `gpu`, so the restart skips WebGPU
      if (backendOf(gpu) === 'webgpu') fallback = 'lost';
      if (renderer === gpu) onLost();
    };
    const failed = (): void => {
      fallback = 'failed';
    };
    let wanted: GPUDevice | null = null;
    if (fallback === null && parts.gpuDevice !== undefined) {
      const offer = await parts.gpuDevice();
      wanted = offer.device;
      fallback = offer.fallback;
    }
    if (wanted !== null) {
      if (mine !== generation) {
        wanted.destroy();
        throw new GraphicsStartError('superseded');
      }
      try {
        const gpu = await startGpu(target, lost, failed, wanted);
        if (backendOf(gpu) === 'webgpu') return { gpu, device: wanted };
        // three fell back to WebGL 2 by itself, and said so
        failed();
        wanted.destroy();
        return { gpu, device: null };
      } catch (error) {
        failed();
        console.warn('WebGPU did not start; drawing with WebGL 2', error);
      }
    }
    // three takes the WebGPU canvas context on the first frame, which a failed start never drew
    // (webgpu-canvas.test.ts), so the canvas is still free for WebGL 2
    return { gpu: await startGpu(target, lost, failed, null), device: null };
  }

  return {
    async init(target) {
      releaseGpu();
      const mine = ++generation;
      const { gpu: next, device: nextDevice } = await start(target, mine);
      if (mine !== generation) {
        release(next, nextDevice);
        target.width = 0;
        target.height = 0;
        throw new GraphicsStartError('superseded');
      }
      renderer = next;
      drawing = createFrame(next);
      device = nextDevice;
      canvas = target;
      contextLost = false;
      next.autoClear = false;
      next.shadowMap.enabled = true;
      next.info.autoReset = false;
      glRenderer = nextDevice === null ? describeGl(next) : describeAdapter(nextDevice.adapterInfo);
      backend = backendOf(next);
      document.addEventListener('visibilitychange', onVisibility);
      resetTiming('init');
      parts.onGovernor?.(timer.trace);
      parts.onRenderer?.(next);
      applySize();
      if (built !== null) applyLookTo(built);
      timer.warmUp();
      // lost after the start settled but before `renderer` named it, so the handler skipped it
      if (gpuLost(next)) onLost();
    },

    onLost(listener) {
      lostListeners.add(listener);
      return () => {
        lostListeners.delete(listener);
      };
    },

    setScene(nextLayout, truck, trailer) {
      disposeBuilt();
      timer.resetScale('scene');
      resetTiming('scene');
      leadAt = -1;
      const palette = readScenePalette();
      const scene = new Scene();
      scene.matrixWorldAutoUpdate = false;
      scene.onBeforeRender = (_renderer, _scene, camera) => {
        if (isShadowCamera(camera)) shadowPasses++;
      };
      const truckVisual = parts.truck(truck, palette);
      const trailerVisual = parts.trailer(trailer, palette);
      const environment = parts.environment(nextLayout, palette);
      const aids = parts.aids(truck, trailer, nextLayout, palette);
      const interior = parts.interior(truck, palette);
      setAidsLayer(aids.object);
      scene.add(environment.object, truckVisual.object, trailerVisual.object, aids.object);
      (interior.frame === 'truck' ? truckVisual.object : scene).add(interior.object);
      built = {
        scene,
        truck: truckVisual,
        trailer: trailerVisual,
        environment,
        aids,
        interior,
        anchors: truckAnchors(truck),
        mounts: mirrorMounts(truck),
        cabFront: cabFront(truck),
        palette,
        yardBounds: fitBounds(nextLayout),
        radius: followRadius(truck, trailer),
      };
      applyLookTo(built);
    },

    setQuality(preset: GraphicsPreset) {
      const next = QUALITY_FLAGS[preset];
      if (next === quality) return;
      if (next.pixelRatioCap !== quality.pixelRatioCap) appliedRatio = 0;
      quality = next;
      for (const { mirror } of mirrors) mirror.setSamples(quality.mirrorMsaa);
      if (built !== null) {
        applyLookTo(built);
        timer.warmUp('quality');
      }
    },

    setLighting(mode: LightingMode) {
      if (mode === lighting) return;
      lighting = mode;
      if (built !== null) {
        applyLookTo(built);
        timer.warmUp('lighting');
      }
    },

    resize(width, height) {
      cssWidth = width;
      cssHeight = height;
      timer.warmUp('resize');
      applySize();
    },

    render(frame) {
      if (renderer === null || built === null || contextLost) return;
      if (cssWidth === 0) return;
      const gl = renderer;
      const out = drawing;
      const b = built;
      if (out === null) return;
      timer.frame(performance.now());
      if (ratio() !== appliedRatio) applySize();
      const pixelRatio = appliedRatio;

      const { snapshot, views } = frame;
      const sky = b.palette.sky;
      b.truck.update(snapshot, frame.lamps);
      b.trailer.update(snapshot, frame.lamps);
      shadowPasses = 0;
      b.environment.update(frame, {
        ...vehicleCentre(snapshot, b.anchors.frontX),
        radius: b.radius,
      });
      b.aids.update(frame);
      b.scene.updateMatrixWorld();

      gl.info.reset();

      const anchors = b.anchors;
      const { cockpit, mirrorLeft: leftRect, mirrorRight: rightRect, topDown } = views;

      const mirrorCallsBefore = gl.info.render.drawCalls;
      for (const { mirror, rect } of mirrors) {
        const r = rect(views);
        if (r === null) {
          mirror.invalidate();
          continue;
        }
        const { spec } = mirror;
        const facing = mirrorFacing(
          snapshot.truck,
          mirrorAnchor(spec, b.mounts),
          spec.yaw,
          mirrorPosition,
        );
        mirror.place(mirrorPosition, facing);
        mirror.capture(gl, b.scene, r.width * pixelRatio, r.height * pixelRatio, sky, frameIndex);
      }
      mirrorCalls = gl.info.render.drawCalls - mirrorCallsBefore;
      frameIndex++;

      // The panes tile the canvas, so on WebGL 2 each clears its own rect as part of its pass: a clear
      // of its own would resolve the whole multisample target once more, and the scissor keeps it to
      // the pane. WebGPU turns an in-pass clear into a load op that ignores the scissor and would wipe
      // the panes drawn before, so there one clear takes the whole target. The sky dome covers each
      // perspective pane.
      gl.setRenderTarget(out.target);
      gl.setClearColor(lighting === 'night' ? b.palette.nightBackdrop : b.palette.backdrop);
      const clearInPass = scissoredClear(backend);
      if (clearInPass) {
        gl.autoClear = true;
      } else {
        out.target.scissorTest = false;
        gl.clear();
      }

      if (cockpit !== null) {
        placeCockpitCamera(cockpitCamera, snapshot.truck, anchors.eye, cockpit);
        b.interior.place({
          camera: cockpitCamera,
          cockpit,
          mirrorLeft: leftRect,
          mirrorRight: rightRect,
        });
        out.place(cockpit, pixelRatio);
        gl.render(b.scene, cockpitCamera);
      }

      out.place(topDown, pixelRatio);
      chaseShown = frame.topDown === 'chase';
      if (chaseShown) {
        placeChaseCamera(
          chaseCamera,
          snapshot.truck,
          b.cabFront,
          {
            width: topDown.width,
            height: topDown.height,
            clear: relativeTo(topDown, frame.topDownClear ?? topDown),
          },
          frame.topDownView ?? DEFAULT_TOP_DOWN_VIEW,
        );
        gl.render(b.scene, chaseCamera);
      } else {
        placeTopDown(frame, topDown, b);
        const shared = gl.lighting;
        let own = topDownLighting.get(gl);
        if (own === undefined) {
          own = new Lighting();
          topDownLighting.set(gl, own);
        }
        gl.lighting = own;
        try {
          gl.render(b.scene, topDownCamera);
        } finally {
          gl.lighting = shared;
        }
      }

      gl.autoClear = false;
      for (const { mirror, rect } of mirrors) {
        const r = rect(views);
        if (r === null) continue;
        out.place(r, pixelRatio);
        mirror.composite(gl);
      }
      out.present();
      // includes the one output pass that draws the frame target to the canvas
      drawCalls = gl.info.render.drawCalls;
    },

    project(x, y) {
      if (topDownRect === null || chaseShown) return null;
      const p = projected.set(x, 0, -y).project(topDownCamera);
      return {
        x: topDownRect.x + ((p.x + 1) / 2) * topDownRect.width,
        y: topDownRect.y + ((1 - p.y) / 2) * topDownRect.height,
      };
    },

    warmUp(tag) {
      timer.warmUp(tag);
    },

    skipFrame() {
      if (renderer === null || contextLost) return;
      timer.frame(performance.now());
    },

    stats(): RenderStats {
      return {
        backend,
        webgpuFallback: backend === 'webgl2' ? fallback : null,
        fps: timer.fps(),
        frameP95Ms: timer.p95Ms(),
        resolutionScale: timer.scale(),
        drawCalls,
        mirrorCalls,
        shadowPasses,
        glRenderer,
        contextLost,
      };
    },

    dispose() {
      disposeBuilt();
      for (const { mirror } of mirrors) mirror.dispose();
      generation++;
      releaseGpu();
      lostListeners.clear();
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
