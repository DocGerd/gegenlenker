import { OrthographicCamera, Scene, UnsignedByteType, Vector3, type Object3D } from 'three';
import { Lighting, WebGPURenderer } from 'three/webgpu';
import type { Rect2, ResolvedLayout } from '../contracts/layout';
import {
  DEFAULT_GRAPHICS,
  DEFAULT_TOP_DOWN_VIEW,
  GraphicsStartError,
  type GraphicsBackend,
  type GraphicsPreset,
  type Rect,
  type RenderFrame,
  type RenderStats,
  type SceneRenderer,
  type ScenePalette,
} from '../contracts/render';
import type { TrailerSpec, TruckAnchors, TruckSpec } from '../contracts/vehicle';
import { truckAnchors } from '../vehicles/anchors';
import { resolveCombination } from '../vehicles/resolve';
import { cabFront, createChaseCamera, placeChaseCamera, type CabFront } from './chase-camera';
import { createCockpitCamera, placeCockpitCamera } from './cockpit-camera';
import { createCockpitInterior } from './cockpit-interior';
import { followFraming, leadTarget, yardFraming } from './follow-framing';
import { createFrameTimer } from './governor';
import { createMirror, mirrorPose } from './mirror';
import { readScenePalette } from './palette';
import { QUALITY_FLAGS } from './quality';
import {
  AIDS_LAYER,
  enableLayers,
  gpuLost,
  TOP_DOWN_LAYERS,
  type AidsLayer,
  type Environment,
  type RendererParts,
  type VehicleVisual,
} from './seams';
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
  readonly anchors: TruckAnchors;
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

function setAidsLayer(object: Object3D): void {
  object.traverse((o) => o.layers.set(AIDS_LAYER));
}

/** `dispose` waits for a pending `init`, so a start that failed rejects again here: nothing new to report. */
function release(gpu: WebGPURenderer, failedStart = false): void {
  gpu.dispose().catch((error: unknown) => {
    if (!failedStart) console.warn('Could not release the GPU renderer', error);
  });
}

function hasWebgl2(canvas: HTMLCanvasElement): boolean {
  try {
    return canvas.getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

/**
 * Settles once the GPU renderer can draw; rejects when it cannot start, as unavailable only when the
 * canvas has no WebGL 2 context. Forced onto WebGL 2 until the WebGPU backend is enabled. `onLost`
 * replaces three's loss handler, which only logs; a loss during `init` rejects instead.
 */
async function startGpu(
  canvas: HTMLCanvasElement,
  onLost: (gpu: WebGPURenderer) => void,
): Promise<WebGPURenderer> {
  let gpu: WebGPURenderer | null = null;
  const loss = { started: false, early: false };
  try {
    const own = new WebGPURenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      forceWebGL: true,
      // the 8-bit canvas WebGLRenderer drew into; half-float with MSAA is far slower on software GL
      outputBufferType: UnsignedByteType,
    });
    gpu = own;
    own.onDeviceLost = () => {
      if (loss.started) onLost(own);
      else loss.early = true;
    };
    await own.init();
  } catch (error) {
    if (gpu !== null) release(gpu, true);
    if (!hasWebgl2(canvas)) throw new GraphicsStartError('unavailable', { cause: error });
    throw error;
  }
  if (loss.early || gpuLost(gpu)) {
    release(gpu);
    throw new Error('The GPU context was lost while starting');
  }
  loss.started = true;
  return gpu;
}

const backendOf = (gpu: WebGPURenderer): GraphicsBackend =>
  (gpu.backend as { isWebGLBackend?: boolean }).isWebGLBackend === true ? 'webgl2' : 'webgpu';

function describeGpu(gpu: WebGPURenderer): string {
  const gl = gpu.getContext() as WebGL2RenderingContext;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const name: unknown = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : undefined;
  return typeof name === 'string' && name !== '' ? name : 'unknown';
}

/** `warmUp` holds the resolution governor off while something heavy (a shell, the ground texture) attaches. */
export function createThreeSceneRenderer(
  parts: RendererParts,
): SceneRenderer & { warmUp: () => void } {
  const timer = createFrameTimer();
  const cockpitCamera = createCockpitCamera();
  const interior = createCockpitInterior();
  const topDownCamera = new OrthographicCamera(-1, 1, 1, -1, 1, SKY_HEIGHT * 2);
  enableLayers(topDownCamera.layers, TOP_DOWN_LAYERS);
  const chaseCamera = createChaseCamera();
  topDownCamera.rotation.x = -Math.PI / 2;
  topDownCamera.position.y = SKY_HEIGHT;
  let quality = QUALITY_FLAGS[DEFAULT_GRAPHICS];
  const mirrorLeft = createMirror(quality.mirrorMsaa);
  const mirrorRight = createMirror(quality.mirrorMsaa);
  const mirrorPosition = new Vector3();
  const projected = new Vector3();

  let renderer: WebGPURenderer | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let built: Built | null = null;
  let cssWidth = 0;
  let cssHeight = 0;
  let appliedRatio = 0;
  let contextLost = false;
  let glRenderer = 'unknown';
  let backend: GraphicsBackend = 'webgl2';
  let drawCalls = 0;
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
    if (document.visibilityState === 'visible') resetTiming();
  };

  /** A long gap between frames (restore, hidden tab, new scene) must not count as slow rendering. */
  function resetTiming(): void {
    timer.resetTiming();
    appliedRatio = 0;
  }

  const ratio = (): number =>
    Math.min(window.devicePixelRatio || 1, quality.pixelRatioCap) * timer.scale();

  function applySize(): void {
    if (renderer === null || cssWidth === 0) return;
    const r = ratio();
    renderer.setPixelRatio(r);
    renderer.setSize(cssWidth, cssHeight, false);
    appliedRatio = r;
  }

  function applyQuality(b: Built): void {
    b.environment.setQuality(quality);
    b.truck.setQuality(quality);
    b.trailer.setQuality(quality);
    interior.setQuality(quality);
  }

  function disposeBuilt(): void {
    if (built === null) return;
    built.truck.dispose();
    built.trailer.dispose();
    built.environment.dispose();
    built.aids.dispose();
    built.scene.clear();
    built = null;
  }

  function placeTopDown(frame: RenderFrame, rect: Rect, b: Built): void {
    const aspect = rect.width / rect.height;
    let cx: number;
    let cy: number;
    let halfH: number;
    if (frame.topDown === 'follow') {
      const { truck, trailer, trailerRear, speed, control } = frame.snapshot;
      const frontX = b.anchors.frontX;
      const bumperX = truck.x + Math.cos(truck.heading) * frontX;
      const bumperY = truck.y + Math.sin(truck.heading) * frontX;
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
        vehicle: { x: (bumperX + trailerRear.x) / 2, y: (bumperY + trailerRear.y) / 2 },
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
    if (renderer !== null) release(renderer);
    renderer = null;
    canvas = null;
  }

  /** WebGPURenderer's viewport origin is the top left, as the CSS rects'. */
  function viewRect(gl: WebGPURenderer, rect: Rect): void {
    gl.setViewport(rect.x, rect.y, rect.width, rect.height);
    gl.setScissor(rect.x, rect.y, rect.width, rect.height);
  }

  return {
    async init(target) {
      releaseGpu();
      const mine = ++generation;
      const next = await startGpu(target, (gpu) => {
        if (renderer === gpu) onLost();
      });
      if (mine !== generation) {
        release(next);
        target.width = 0;
        target.height = 0;
        throw new GraphicsStartError('superseded');
      }
      renderer = next;
      canvas = target;
      contextLost = false;
      next.autoClear = false;
      next.info.autoReset = false;
      glRenderer = describeGpu(next);
      backend = backendOf(next);
      document.addEventListener('visibilitychange', onVisibility);
      resetTiming();
      parts.onRenderer?.(next);
      applySize();
      if (built !== null) applyQuality(built);
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
      resetTiming();
      timer.resetScale();
      leadAt = -1;
      const palette = readScenePalette();
      const scene = new Scene();
      scene.matrixWorldAutoUpdate = false;
      const truckVisual = parts.truck(truck, palette);
      const trailerVisual = parts.trailer(trailer, palette);
      const environment = parts.environment(nextLayout, palette);
      const aids = parts.aids(truck, trailer, nextLayout, palette);
      setAidsLayer(aids.object);
      scene.add(
        environment.object,
        truckVisual.object,
        trailerVisual.object,
        aids.object,
        interior.object,
      );
      built = {
        scene,
        truck: truckVisual,
        trailer: trailerVisual,
        environment,
        aids,
        anchors: truckAnchors(truck),
        cabFront: cabFront(truck),
        palette,
        yardBounds: fitBounds(nextLayout),
        radius: followRadius(truck, trailer),
      };
      applyQuality(built);
    },

    setQuality(preset: GraphicsPreset) {
      const next = QUALITY_FLAGS[preset];
      if (next === quality) return;
      if (next.pixelRatioCap !== quality.pixelRatioCap) appliedRatio = 0;
      quality = next;
      mirrorLeft.setSamples(quality.mirrorMsaa);
      mirrorRight.setSamples(quality.mirrorMsaa);
      if (built !== null) {
        applyQuality(built);
        timer.warmUp();
      }
    },

    resize(width, height) {
      cssWidth = width;
      cssHeight = height;
      timer.warmUp();
      applySize();
    },

    render(frame) {
      if (renderer === null || built === null || contextLost) return;
      if (cssWidth === 0) return;
      const gl = renderer;
      const b = built;
      timer.frame(performance.now());
      if (ratio() !== appliedRatio) applySize();
      const pixelRatio = appliedRatio;

      const { snapshot, views } = frame;
      const sky = b.palette.sky;
      b.truck.update(snapshot);
      b.trailer.update(snapshot);
      b.environment.update(frame);
      b.aids.update(frame);
      b.scene.updateMatrixWorld();

      gl.info.reset();
      gl.setScissorTest(false);

      const anchors = b.anchors;
      const { cockpit, mirrorLeft: leftRect, mirrorRight: rightRect, topDown } = views;

      if (leftRect !== null) {
        const facing = mirrorPose(snapshot.truck, anchors.mirrorLeft, 'left', mirrorPosition);
        mirrorLeft.place(mirrorPosition, facing);
        mirrorLeft.capture(
          gl,
          b.scene,
          leftRect.width * pixelRatio,
          leftRect.height * pixelRatio,
          sky,
        );
      }
      if (rightRect !== null) {
        const facing = mirrorPose(snapshot.truck, anchors.mirrorRight, 'right', mirrorPosition);
        mirrorRight.place(mirrorPosition, facing);
        mirrorRight.capture(
          gl,
          b.scene,
          rightRect.width * pixelRatio,
          rightRect.height * pixelRatio,
          sky,
        );
      }

      // One clear for every pane: they tile the canvas, and the sky dome covers each perspective one.
      gl.setRenderTarget(null);
      gl.setClearColor(b.palette.backdrop);
      gl.clear();
      gl.setScissorTest(true);

      if (cockpit !== null) {
        placeCockpitCamera(cockpitCamera, snapshot.truck, anchors.eye, cockpit);
        interior.place(cockpitCamera, cockpit, leftRect, rightRect);
        viewRect(gl, cockpit);
        gl.render(b.scene, cockpitCamera);
      }

      viewRect(gl, topDown);
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

      if (leftRect !== null) mirrorLeft.composite(gl, leftRect);
      if (rightRect !== null) mirrorRight.composite(gl, rightRect);
      gl.setScissorTest(false);
      // includes one output pass per canvas render: the frame is drawn into an intermediate target
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

    warmUp() {
      timer.warmUp();
    },

    skipFrame() {
      if (renderer === null || contextLost) return;
      timer.frame(performance.now());
    },

    stats(): RenderStats {
      return {
        backend,
        fps: timer.fps(),
        frameP95Ms: timer.p95Ms(),
        resolutionScale: timer.scale(),
        drawCalls,
        glRenderer,
        contextLost,
      };
    },

    dispose() {
      disposeBuilt();
      interior.dispose();
      mirrorLeft.dispose();
      mirrorRight.dispose();
      generation++;
      releaseGpu();
      lostListeners.clear();
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
