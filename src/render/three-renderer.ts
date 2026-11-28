import { OrthographicCamera, Scene, Vector3, type Camera, type Object3D } from 'three';
import { Lighting, WebGPURenderer } from 'three/webgpu';
import type { Rect2, ResolvedLayout } from '../contracts/layout';
import {
  DEFAULT_GRAPHICS,
  DEFAULT_LIGHTING,
  DEFAULT_TOP_DOWN_VIEW,
  GraphicsStartError,
  HEAD_REST,
  type GraphicsBackend,
  type GraphicsPreset,
  type LightingMode,
  type Rect,
  type ViewRects,
  type RenderFrame,
  type RenderStats,
  type ScenePalette,
  type TopDownView,
  type WebgpuFallback,
} from '../contracts/render';
import type { TrailerSpec, TruckAnchors, TruckId, TruckSpec } from '../contracts/vehicle';
import { truckAnchors } from '../vehicles/anchors';
import {
  cabFront,
  boundingRadius,
  chaseColliders,
  combinationExtent,
  createChaseArm,
  cameraPose,
  createChaseCamera,
  placeChaseCamera,
  placeFreeCamera,
  vehicleCentre,
  type CabFront,
  type ChaseCollider,
  type CombinationExtent,
} from './chase-camera';
import type { SceneRenderer, SightFlags } from './scene-renderer';
import { createCockpitCamera, placeCockpitCamera } from './cockpit-camera';
import { createEinweiserArms, placeViewModelCamera, type EinweiserArms } from './einweiser-arms';
import { createEinweiserCamera, placeEinweiserCamera } from './einweiser-camera';
import { createSightCones, type SightCones } from './sight-cones';
import { followFraming, leadTarget, yardFraming } from './follow-framing';
import { createFrameTimer } from './governor';
import { createFrame, type Frame } from './frame-target';
import { describeAdapter } from './gpu-backend';
import {
  createMirror,
  mirrorAnchor,
  mirrorYaw,
  mirrorFacing,
  type MirrorMounts,
  mirrorMounts,
  MIRRORS,
} from './mirror';
import { readScenePalette } from './palette';
import { lookFor, type Look } from './look';
import { QUALITY_FLAGS } from './quality';
import { hasTopDown } from './viewports';
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
/** Time constant of the look-ahead shift, so a gear change glides instead of jumping. */
const LEAD_SECONDS = 0.5;
const MAX_LEAD_STEP_SECONDS = 0.25;
const YARD_MARGIN = 5;
const SKY_HEIGHT = 200;

/** One scene part: `object` joins `parent` (default the scene); look and teardown follow the list. */
type Part = {
  readonly object: Object3D;
  readonly parent?: Object3D;
  /** Survives a rebuild: its owner carries it into the next `Built`. */
  readonly keepOnRebuild?: boolean;
  setLook(look: Look): void;
  dispose(): void;
};

/** Wraps a part to place it, without copying its methods off their owner. */
const placed = (part: Part, how: Pick<Part, 'parent' | 'keepOnRebuild'>): Part => ({
  object: part.object,
  setLook: (look) => part.setLook(look),
  dispose: () => part.dispose(),
  ...how,
});

type Built = {
  readonly parts: readonly Part[];
  readonly layout: ResolvedLayout;
  readonly truckSpec: TruckSpec;
  /** Null: the truck solo. */
  readonly trailerSpec: TrailerSpec | null;
  readonly scene: Scene;
  readonly truck: VehicleVisual;
  readonly trailer: VehicleVisual | null;
  readonly environment: Environment;
  readonly aids: AidsLayer;
  readonly interior: CockpitInterior;
  readonly arms: EinweiserArms;
  readonly sight: SightCones;
  readonly truckId: TruckId;
  readonly anchors: TruckAnchors;
  readonly mounts: MirrorMounts;
  readonly cabFront: CabFront;
  readonly palette: ScenePalette;
  readonly yardBounds: Rect2;
  readonly colliders: readonly ChaseCollider[];
  readonly extent: CombinationExtent;
  /** Metres from the follow centre that bound the whole combination. */
  readonly radius: number;
};

/**
 * three keeps one light list per scene and Lighting; the top-down view sees other lights than the
 * perspective ones (light-rig.ts), so a list of its own keeps both, and every cache key, stable.
 */
const topDownLighting = new WeakMap<WebGPURenderer, Lighting>();
/** The Einweiser's arms see no light at all: their pass keeps a list of its own for the same reason. */
const viewModelLighting = new WeakMap<WebGPURenderer, Lighting>();

/** Renders `camera`'s pass with the light list `lists` keeps for `gl`. */
function renderLitBy(
  lists: WeakMap<WebGPURenderer, Lighting>,
  gl: WebGPURenderer,
  scene: Scene,
  camera: Camera,
): void {
  const shared = gl.lighting;
  let own = lists.get(gl);
  if (own === undefined) {
    own = new Lighting();
    lists.set(gl, own);
  }
  gl.lighting = own;
  try {
    gl.render(scene, camera);
  } finally {
    gl.lighting = shared;
  }
}

/**
 * Draws the arms over the pane just drawn: their depth is cleared in the pass, so they never clip into
 * the scene, and its colour kept. On WebGPU the depth clear ignores the scissor, which leaves the colour
 * of the panes drawn before intact.
 */
function drawViewModel(gl: WebGPURenderer, scene: Scene, arms: EinweiserArms): void {
  const { autoClear, autoClearColor, autoClearDepth, autoClearStencil } = gl;
  gl.autoClear = true;
  gl.autoClearColor = false;
  gl.autoClearDepth = true;
  gl.autoClearStencil = false;
  try {
    renderLitBy(viewModelLighting, gl, scene, arms.camera);
  } finally {
    gl.autoClear = autoClear;
    gl.autoClearColor = autoClearColor;
    gl.autoClearDepth = autoClearDepth;
    gl.autoClearStencil = autoClearStencil;
  }
}

/** What one frame's passes share. */
type Pass = {
  readonly gl: WebGPURenderer;
  readonly out: Frame;
  readonly b: Built;
  readonly frame: RenderFrame;
  readonly pixelRatio: number;
};

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

const isDefault = (view: TopDownView): boolean =>
  view.zoom === DEFAULT_TOP_DOWN_VIEW.zoom &&
  view.panX === DEFAULT_TOP_DOWN_VIEW.panX &&
  view.panY === DEFAULT_TOP_DOWN_VIEW.panY;

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
): SceneRenderer & { warmUp: (tag?: string) => void; attached: () => void } {
  const timer = createFrameTimer();
  const cockpitCamera = createCockpitCamera();
  const einweiserCamera = createEinweiserCamera();
  const topDownCamera = new OrthographicCamera(-1, 1, 1, -1, 1, SKY_HEIGHT * 2);
  enableLayers(topDownCamera.layers, TOP_DOWN_LAYERS);
  const chaseCamera = createChaseCamera();
  topDownCamera.rotation.x = -Math.PI / 2;
  topDownCamera.position.y = SKY_HEIGHT;
  let quality = QUALITY_FLAGS[DEFAULT_GRAPHICS];
  let lighting: LightingMode = DEFAULT_LIGHTING;
  let sightFlags: SightFlags = { top: false, ground: false };
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
  const chaseArm = createChaseArm();
  let chaseView = DEFAULT_TOP_DOWN_VIEW;
  let chaseFlown = false;
  const lead = { x: 0, y: 0 };
  let leadAt = -1;
  /** Bumped by every `init` and by `dispose`, so a superseded start drops its renderer. */
  let generation = 0;
  const lostListeners = new Set<() => void>();
  const attachListeners = new Set<() => void>();

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
    for (const part of b.parts) part.setLook(look);
    for (const { mirror } of mirrors) mirror.invalidate();
  }

  /** `keepRebuildParts` spares parts flagged `keepOnRebuild`: the aids part carries its track history over a rebuild. */
  function disposeBuilt({ keepRebuildParts = false } = {}): void {
    if (built === null) return;
    for (const part of built.parts) {
      if (!(keepRebuildParts && part.keepOnRebuild === true)) part.dispose();
    }
    built.scene.clear();
    built = null;
  }

  function build(
    nextLayout: ResolvedLayout,
    truck: TruckSpec,
    trailer: TrailerSpec | null,
    palette: ScenePalette,
    kept?: AidsLayer,
  ): void {
    const scene = new Scene();
    scene.matrixWorldAutoUpdate = false;
    scene.onBeforeRender = (_renderer, _scene, camera) => {
      if (isShadowCamera(camera)) shadowPasses++;
    };
    const truckVisual = parts.truck(truck, palette);
    const trailerVisual = trailer === null ? null : parts.trailer(trailer, palette);
    const environment = parts.environment(nextLayout, palette);
    const aids = kept ?? parts.aids(truck, trailer, nextLayout, palette);
    const interior = parts.interior(truck, palette);
    const arms = createEinweiserArms();
    const sight = createSightCones(truck, trailer, nextLayout, palette);
    sight.setFlags(sightFlags);
    const extent = combinationExtent(truck, trailer);
    setAidsLayer(aids.object);
    // the scene order of a combination is kept: its lights' order is part of every program
    const list: readonly Part[] = [
      environment,
      truckVisual,
      ...(trailerVisual === null ? [] : [trailerVisual]),
      placed(aids, { keepOnRebuild: true }),
      arms,
      sight,
      placed(interior, { parent: interior.frame === 'truck' ? truckVisual.object : scene }),
    ];
    for (const part of list) (part.parent ?? scene).add(part.object);
    built = {
      parts: list,
      layout: nextLayout,
      truckSpec: truck,
      trailerSpec: trailer,
      scene,
      truck: truckVisual,
      trailer: trailerVisual,
      environment,
      aids,
      interior,
      arms,
      sight,
      truckId: truck.id,
      anchors: truckAnchors(truck),
      mounts: mirrorMounts(truck),
      cabFront: cabFront(truck),
      palette,
      yardBounds: fitBounds(nextLayout),
      colliders: chaseColliders(nextLayout),
      extent,
      radius: boundingRadius(extent),
    };
    applyLookTo(built);
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

  function updateScene({ b, frame }: Pass): void {
    const { snapshot, views } = frame;
    b.truck.update(snapshot, frame.lamps);
    b.trailer?.update(snapshot, frame.lamps);
    shadowPasses = 0;
    b.environment.update(frame, {
      ...vehicleCentre(snapshot, b.anchors.frontX),
      radius: b.radius,
    });
    b.aids.update(frame);
    b.arms.update(views.cockpit === null ? undefined : frame.einweiser);
    b.sight.update(frame);
    b.scene.updateMatrixWorld();
  }

  function captureMirrors({ gl, b, frame, pixelRatio }: Pass): void {
    const { snapshot, views } = frame;
    const before = gl.info.render.drawCalls;
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
        mirrorYaw(spec, b.truckId),
        mirrorPosition,
      );
      mirror.place(mirrorPosition, facing);
      mirror.capture(
        gl,
        b.scene,
        r.width * pixelRatio,
        r.height * pixelRatio,
        b.palette.sky,
        frameIndex,
      );
    }
    mirrorCalls = gl.info.render.drawCalls - before;
    frameIndex++;
  }

  // The panes tile the canvas, so on WebGL 2 each clears its own rect as part of its pass: a clear
  // of its own would resolve the whole multisample target once more, and the scissor keeps it to
  // the pane. WebGPU turns an in-pass clear into a load op that ignores the scissor and would wipe
  // the panes drawn before, so there one clear takes the whole target. The sky dome covers each
  // perspective pane.
  function clearTarget({ gl, out, b }: Pass): void {
    gl.setRenderTarget(out.target);
    gl.setClearColor(lighting === 'night' ? b.palette.nightBackdrop : b.palette.backdrop);
    if (scissoredClear(backend)) {
      gl.autoClear = true;
    } else {
      out.target.scissorTest = false;
      gl.clear();
    }
  }

  /** In the Einweiser role the cockpit rect is his first-person view: his eye stands outside the cab. */
  function drawCockpit({ gl, out, b, frame, pixelRatio }: Pass): void {
    const { cockpit, mirrorLeft, mirrorRight } = frame.views;
    if (cockpit === null) return;
    if (frame.einweiser !== undefined) {
      placeEinweiserCamera(einweiserCamera, frame.einweiser, cockpit, frame.fov);
      out.place(cockpit, pixelRatio);
      gl.render(b.scene, einweiserCamera);
      placeViewModelCamera(b.arms.camera, cockpit);
      drawViewModel(gl, b.scene, b.arms);
    } else {
      const { truck } = frame.snapshot;
      const head = b.interior.looksAround === true ? (frame.head ?? HEAD_REST) : HEAD_REST;
      placeCockpitCamera(cockpitCamera, truck, b.anchors.eye, cockpit, head);
      b.interior.place({
        camera: cockpitCamera,
        heading: truck.heading,
        cockpit,
        mirrorLeft,
        mirrorRight,
      });
      out.place(cockpit, pixelRatio);
      gl.render(b.scene, cockpitCamera);
    }
  }

  function placeChase(
    { b, frame }: Pass,
    topDown: Rect,
    chaseWasShown: boolean,
    chaseWasFlown: boolean,
  ): void {
    const { snapshot } = frame;
    const view = frame.topDownView ?? DEFAULT_TOP_DOWN_VIEW;
    // a reset, a switch to the view or the end of a flight is a cut: the eye starts where the view puts it
    if (
      !chaseWasShown ||
      chaseWasFlown !== chaseFlown ||
      (isDefault(view) && !isDefault(chaseView))
    ) {
      chaseArm.cut();
    }
    chaseView = view;
    const rig = {
      truck: snapshot.truck,
      centre: vehicleCentre(snapshot, b.anchors.frontX),
      extent: b.extent,
      face: b.cabFront,
      colliders: b.colliders,
    };
    const paneFrame = {
      width: topDown.width,
      height: topDown.height,
      clear: relativeTo(topDown, frame.topDownClear ?? topDown),
    };
    if (frame.freePose !== undefined) {
      placeFreeCamera(chaseCamera, frame.freePose, rig, paneFrame);
    } else {
      placeChaseCamera(chaseCamera, rig, paneFrame, view, (limit, open) =>
        chaseArm.hold(limit, open, performance.now()),
      );
    }
  }

  /** The top-down pane: the chase or free view, else the plan view. */
  function drawPane(pass: Pass): void {
    const { gl, out, b, frame, pixelRatio } = pass;
    const { topDown } = frame.views;
    // A mirror-only drive has no top-down pane: the cockpit took the whole canvas.
    const hasPane = hasTopDown(frame.views);
    if (hasPane) out.place(topDown, pixelRatio);
    const chaseWasShown = chaseShown;
    const chaseWasFlown = chaseFlown;
    chaseShown = hasPane && frame.topDown === 'chase';
    chaseFlown = chaseShown && frame.freePose !== undefined;
    if (!hasPane) {
      topDownRect = null;
    } else if (chaseShown) {
      placeChase(pass, topDown, chaseWasShown, chaseWasFlown);
      gl.render(b.scene, chaseCamera);
    } else {
      placeTopDown(frame, topDown, b);
      renderLitBy(topDownLighting, gl, b.scene, topDownCamera);
    }
  }

  function compositeMirrors({ gl, out, frame, pixelRatio }: Pass): void {
    gl.autoClear = false;
    for (const { mirror, rect } of mirrors) {
      const r = rect(frame.views);
      if (r === null) continue;
      out.place(r, pixelRatio);
      mirror.composite(gl);
    }
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
      chaseArm.cut();
      build(nextLayout, truck, trailer, readScenePalette());
    },

    rebuildScene() {
      if (built === null) return;
      const { layout: nextLayout, truckSpec, trailerSpec, palette, aids } = built;
      disposeBuilt({ keepRebuildParts: true });
      resetTiming('rebuild');
      build(nextLayout, truckSpec, trailerSpec, palette, aids);
    },

    onAttached(listener) {
      attachListeners.add(listener);
      return () => {
        attachListeners.delete(listener);
      };
    },

    attached() {
      for (const listener of [...attachListeners]) listener();
    },

    setQuality(preset: GraphicsPreset) {
      const next = QUALITY_FLAGS[preset];
      if (next === quality) return;
      if (next.pixelRatioCap !== quality.pixelRatioCap) appliedRatio = 0;
      quality = next;
      for (const { mirror } of mirrors) mirror.setSamples(quality.mirrorMsaa);
      if (built !== null) {
        applyLookTo(built);
        timer.warmUp('quality', { liftParks: true });
      }
    },

    setLighting(mode: LightingMode) {
      if (mode === lighting) return;
      lighting = mode;
      if (built !== null) {
        applyLookTo(built);
        timer.warmUp('lighting', { liftParks: true });
      }
    },

    setSightCones(flags: SightFlags) {
      sightFlags = flags;
      built?.sight.setFlags(flags);
    },

    sightPending: () => built?.sight.pending() ?? false,

    resize(width, height) {
      cssWidth = width;
      cssHeight = height;
      timer.warmUp('resize');
      applySize();
    },

    render(frame) {
      if (renderer === null || built === null || contextLost) return;
      if (cssWidth === 0) return;
      const out = drawing;
      if (out === null) return;
      timer.frame(performance.now());
      if (ratio() !== appliedRatio) applySize();
      const pass: Pass = { gl: renderer, out, b: built, frame, pixelRatio: appliedRatio };

      updateScene(pass);
      pass.gl.info.reset();
      captureMirrors(pass);
      clearTarget(pass);
      drawCockpit(pass);
      drawPane(pass);
      compositeMirrors(pass);
      pass.out.present();
      // includes the one output pass that draws the frame target to the canvas
      drawCalls = pass.gl.info.render.drawCalls;
    },

    chasePose() {
      return chaseShown && built !== null ? cameraPose(chaseCamera) : null;
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
      attachListeners.clear();
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
