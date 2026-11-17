import {
  MathUtils,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from 'three';
import type { Rect2, ResolvedLayout } from '../contracts/layout';
import {
  DEFAULT_TOP_DOWN_VIEW,
  type Rect,
  type RenderFrame,
  type RenderStats,
  type SceneRenderer,
  type ScenePalette,
} from '../contracts/render';
import type { TruckAnchors } from '../contracts/vehicle';
import { truckAnchors } from '../vehicles/anchors';
import { bodyToThree } from './coords';
import { createFrameTimer } from './governor';
import { createMirror } from './mirror';
import { readScenePalette } from './palette';
import {
  AIDS_LAYER,
  SKY_LAYER,
  type AidsLayer,
  type Environment,
  type RendererParts,
  type VehicleVisual,
} from './seams';
import { placeTopDownCamera } from './top-down-camera';

const COCKPIT_FOV = 55;
const COCKPIT_PITCH = MathUtils.degToRad(-6);
const MIRROR_YAW = MathUtils.degToRad(7);
const FOLLOW_HALF_HEIGHT = 20;
const YARD_MARGIN = 5;
const FAR = 400;
const SKY_HEIGHT = 200;
const MAX_PIXEL_RATIO = 2;

type Built = {
  readonly scene: Scene;
  readonly truck: VehicleVisual;
  readonly trailer: VehicleVisual;
  readonly environment: Environment;
  readonly aids: AidsLayer;
  readonly anchors: TruckAnchors;
  readonly palette: ScenePalette;
  readonly yardBounds: Rect2;
};

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

function setAidsLayer(object: Object3D): void {
  object.traverse((o) => o.layers.set(AIDS_LAYER));
}

export function createThreeSceneRenderer(parts: RendererParts): SceneRenderer {
  const timer = createFrameTimer();
  const cockpitCamera = new PerspectiveCamera(COCKPIT_FOV, 1, 0.1, FAR);
  cockpitCamera.rotation.order = 'YXZ';
  const topDownCamera = new OrthographicCamera(-1, 1, 1, -1, 1, SKY_HEIGHT * 2);
  cockpitCamera.layers.enable(SKY_LAYER);
  topDownCamera.layers.enable(AIDS_LAYER);
  topDownCamera.rotation.x = -Math.PI / 2;
  topDownCamera.position.y = SKY_HEIGHT;
  const mirrorLeft = createMirror();
  const mirrorRight = createMirror();
  const mirrorPosition = new Vector3();

  let renderer: WebGLRenderer | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let built: Built | null = null;
  let cssWidth = 0;
  let cssHeight = 0;
  let appliedRatio = 0;
  let contextLost = false;
  let glRenderer = 'unknown';
  let drawCalls = 0;

  const onLost = (event: Event): void => {
    event.preventDefault();
    contextLost = true;
  };
  const onRestored = (): void => {
    contextLost = false;
    resetTiming();
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
    Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO) * timer.scale();

  function applySize(): void {
    if (renderer === null || cssWidth === 0) return;
    const r = ratio();
    renderer.setPixelRatio(r);
    renderer.setSize(cssWidth, cssHeight, false);
    appliedRatio = r;
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
      const { truck, trailerRear } = frame.snapshot;
      const frontX = b.anchors.frontX;
      const bumperX = truck.x + Math.cos(truck.heading) * frontX;
      const bumperY = truck.y + Math.sin(truck.heading) * frontX;
      cx = (bumperX + trailerRear.x) / 2;
      cy = (bumperY + trailerRear.y) / 2;
      halfH = FOLLOW_HALF_HEIGHT;
    } else {
      const bounds = b.yardBounds;
      cx = (bounds.minX + bounds.maxX) / 2;
      cy = (bounds.minY + bounds.maxY) / 2;
      halfH = Math.max((bounds.maxY - bounds.minY) / 2, (bounds.maxX - bounds.minX) / 2 / aspect);
    }
    placeTopDownCamera(
      topDownCamera,
      { x: cx, y: cy },
      halfH,
      aspect,
      frame.topDownView ?? DEFAULT_TOP_DOWN_VIEW,
    );
  }

  function viewRect(gl: WebGLRenderer, rect: Rect): void {
    const y = cssHeight - rect.y - rect.height;
    gl.setViewport(rect.x, y, rect.width, rect.height);
    gl.setScissor(rect.x, y, rect.width, rect.height);
  }

  return {
    init(target) {
      canvas = target;
      renderer = new WebGLRenderer({
        canvas: target,
        antialias: true,
        powerPreference: 'high-performance',
      });
      renderer.autoClear = false;
      renderer.info.autoReset = false;
      const gl = renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name: unknown = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : undefined;
      glRenderer = typeof name === 'string' && name !== '' ? name : 'unknown';
      target.addEventListener('webglcontextlost', onLost);
      target.addEventListener('webglcontextrestored', onRestored);
      document.addEventListener('visibilitychange', onVisibility);
      applySize();
    },

    setScene(nextLayout, truck, trailer) {
      disposeBuilt();
      resetTiming();
      const palette = readScenePalette();
      const scene = new Scene();
      scene.matrixWorldAutoUpdate = false;
      const truckVisual = parts.truck(truck, palette);
      const trailerVisual = parts.trailer(trailer, palette);
      const environment = parts.environment(nextLayout, palette);
      const aids = parts.aids(truck, trailer, nextLayout, palette);
      setAidsLayer(aids.object);
      scene.add(environment.object, truckVisual.object, trailerVisual.object, aids.object);
      built = {
        scene,
        truck: truckVisual,
        trailer: trailerVisual,
        environment,
        aids,
        anchors: truckAnchors(truck),
        palette,
        yardBounds: fitBounds(nextLayout),
      };
    },

    resize(width, height) {
      cssWidth = width;
      cssHeight = height;
      timer.resetScale();
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
      b.aids.update(frame);
      b.scene.updateMatrixWorld();

      gl.info.reset();
      gl.setScissorTest(false);

      const anchors = b.anchors;
      const heading = snapshot.truck.heading;
      const { cockpit, mirrorLeft: leftRect, mirrorRight: rightRect, topDown } = views;

      if (leftRect !== null) {
        mirrorLeft.place(
          bodyToThree(snapshot.truck, anchors.mirrorLeft, mirrorPosition),
          heading + Math.PI - MIRROR_YAW,
        );
        mirrorLeft.capture(
          gl,
          b.scene,
          leftRect.width * pixelRatio,
          leftRect.height * pixelRatio,
          sky,
        );
      }
      if (rightRect !== null) {
        mirrorRight.place(
          bodyToThree(snapshot.truck, anchors.mirrorRight, mirrorPosition),
          heading + Math.PI + MIRROR_YAW,
        );
        mirrorRight.capture(
          gl,
          b.scene,
          rightRect.width * pixelRatio,
          rightRect.height * pixelRatio,
          sky,
        );
      }

      gl.setRenderTarget(null);
      gl.setClearColor(sky);
      gl.clear();
      gl.setScissorTest(true);

      if (cockpit !== null) {
        bodyToThree(snapshot.truck, anchors.eye, cockpitCamera.position);
        cockpitCamera.rotation.set(COCKPIT_PITCH, heading - Math.PI / 2, 0);
        cockpitCamera.aspect = cockpit.width / cockpit.height;
        cockpitCamera.updateProjectionMatrix();
        viewRect(gl, cockpit);
        gl.render(b.scene, cockpitCamera);
      }

      placeTopDown(frame, topDown, b);
      viewRect(gl, topDown);
      gl.setClearColor(b.palette.backdrop);
      gl.clear();
      gl.render(b.scene, topDownCamera);

      if (leftRect !== null) mirrorLeft.composite(gl, leftRect, cssHeight);
      if (rightRect !== null) mirrorRight.composite(gl, rightRect, cssHeight);
      gl.setScissorTest(false);
      drawCalls = gl.info.render.calls;
    },

    skipFrame() {
      if (renderer === null || contextLost) return;
      timer.frame(performance.now());
    },

    stats(): RenderStats {
      return {
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
      mirrorLeft.dispose();
      mirrorRight.dispose();
      canvas?.removeEventListener('webglcontextlost', onLost);
      canvas?.removeEventListener('webglcontextrestored', onRestored);
      document.removeEventListener('visibilitychange', onVisibility);
      renderer?.dispose();
      renderer = null;
      canvas = null;
    },
  };
}
