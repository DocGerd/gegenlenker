import {
  MathUtils,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  type Object3D,
} from 'three';
import type { Rect2, ResolvedLayout } from '../contracts/layout';
import type {
  Rect,
  RenderFrame,
  RenderStats,
  SceneRenderer,
  ScenePalette,
} from '../contracts/render';
import type { TruckSpec } from '../contracts/vehicle';
import { truckAnchors } from '../vehicles/anchors';
import { bodyToThree } from './coords';
import { createResolutionGovernor } from './governor';
import { createMirror } from './mirror';
import {
  AIDS_LAYER,
  type AidsLayer,
  type Environment,
  type RendererParts,
  type VehicleVisual,
} from './seams';

const COCKPIT_FOV = 55;
const COCKPIT_PITCH = MathUtils.degToRad(-6);
const MIRROR_YAW = MathUtils.degToRad(7);
const FOLLOW_HALF_HEIGHT = 20;
const YARD_MARGIN = 5;
const FAR = 400;
const SKY_HEIGHT = 200;
const FPS_SMOOTHING = 0.1;
const P95_WINDOW = 120;
const MAX_PIXEL_RATIO = 2;

type Built = {
  readonly scene: Scene;
  readonly truck: VehicleVisual;
  readonly trailer: VehicleVisual;
  readonly environment: Environment;
  readonly aids: AidsLayer;
  readonly truckSpec: TruckSpec;
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
  object.traverse((o) => {
    if (o.layers.mask !== 1 << AIDS_LAYER) o.layers.set(AIDS_LAYER);
  });
}

export function createThreeSceneRenderer(parts: RendererParts): SceneRenderer {
  const governor = createResolutionGovernor();
  const cockpitCamera = new PerspectiveCamera(COCKPIT_FOV, 1, 0.1, FAR);
  cockpitCamera.rotation.order = 'YXZ';
  const topDownCamera = new OrthographicCamera(-1, 1, 1, -1, 1, SKY_HEIGHT * 2);
  topDownCamera.layers.enable(AIDS_LAYER);
  topDownCamera.rotation.x = -Math.PI / 2;
  const mirrorLeft = createMirror();
  const mirrorRight = createMirror();

  let renderer: WebGLRenderer | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let built: Built | null = null;
  let cssWidth = 0;
  let cssHeight = 0;
  let appliedRatio = 0;
  let contextLost = false;
  let glRenderer = 'unknown';
  let lastRender = 0;
  let fps = 0;
  let drawCalls = 0;
  const intervals: number[] = [];

  const onLost = (event: Event): void => {
    event.preventDefault();
    contextLost = true;
  };
  const onRestored = (): void => {
    contextLost = false;
    appliedRatio = 0;
  };

  const ratio = (): number =>
    Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO) * governor.scale();

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
      const frontX = truckAnchors(b.truckSpec).frontX;
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
    topDownCamera.left = -halfH * aspect;
    topDownCamera.right = halfH * aspect;
    topDownCamera.top = halfH;
    topDownCamera.bottom = -halfH;
    topDownCamera.position.set(cx, SKY_HEIGHT, -cy);
    topDownCamera.updateProjectionMatrix();
  }

  function viewRect(gl: WebGLRenderer, rect: Rect): void {
    const y = cssHeight - rect.y - rect.height;
    gl.setViewport(rect.x, y, rect.width, rect.height);
    gl.setScissor(rect.x, y, rect.width, rect.height);
  }

  function recordInterval(now: number): void {
    if (lastRender > 0) {
      const dt = now - lastRender;
      fps = fps === 0 ? 1000 / dt : fps + FPS_SMOOTHING * (1000 / dt - fps);
      intervals.push(dt);
      if (intervals.length > P95_WINDOW) intervals.shift();
      governor.sample(dt);
    }
    lastRender = now;
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
      applySize();
    },

    setScene(nextLayout, truck, trailer, palette) {
      disposeBuilt();
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
        truckSpec: truck,
        palette,
        yardBounds: fitBounds(nextLayout),
      };
    },

    resize(width, height) {
      cssWidth = width;
      cssHeight = height;
      governor.reset();
      applySize();
    },

    render(frame) {
      if (renderer === null || built === null || contextLost) return;
      if (cssWidth === 0) return;
      const gl = renderer;
      const b = built;
      recordInterval(performance.now());
      if (ratio() !== appliedRatio) applySize();
      const pixelRatio = appliedRatio;

      const { snapshot, views } = frame;
      b.truck.update(snapshot);
      b.trailer.update(snapshot);
      b.aids.update(frame);
      setAidsLayer(b.aids.object);
      b.scene.updateMatrixWorld();

      gl.info.reset();
      gl.setClearColor(b.palette.sky);
      gl.setScissorTest(false);

      const anchors = truckAnchors(b.truckSpec);
      const heading = snapshot.truck.heading;
      const { cockpit, mirrorLeft: leftRect, mirrorRight: rightRect, topDown } = views;

      if (leftRect !== null) {
        mirrorLeft.place(
          bodyToThree(snapshot.truck, anchors.mirrorLeft),
          heading + Math.PI - MIRROR_YAW,
        );
        mirrorLeft.capture(gl, b.scene, leftRect.width * pixelRatio, leftRect.height * pixelRatio);
      }
      if (rightRect !== null) {
        mirrorRight.place(
          bodyToThree(snapshot.truck, anchors.mirrorRight),
          heading + Math.PI + MIRROR_YAW,
        );
        mirrorRight.capture(
          gl,
          b.scene,
          rightRect.width * pixelRatio,
          rightRect.height * pixelRatio,
        );
      }

      gl.setRenderTarget(null);
      gl.clear();
      gl.setScissorTest(true);

      if (cockpit !== null) {
        cockpitCamera.position.copy(bodyToThree(snapshot.truck, anchors.eye));
        cockpitCamera.rotation.set(COCKPIT_PITCH, heading - Math.PI / 2, 0);
        cockpitCamera.aspect = cockpit.width / cockpit.height;
        cockpitCamera.updateProjectionMatrix();
        viewRect(gl, cockpit);
        gl.render(b.scene, cockpitCamera);
      }

      placeTopDown(frame, topDown, b);
      viewRect(gl, topDown);
      gl.render(b.scene, topDownCamera);

      if (leftRect !== null) mirrorLeft.composite(gl, leftRect, cssHeight);
      if (rightRect !== null) mirrorRight.composite(gl, rightRect, cssHeight);
      gl.setScissorTest(false);
      drawCalls = gl.info.render.calls;
    },

    stats(): RenderStats {
      const sorted = [...intervals].sort((a, c) => a - c);
      const p95 = sorted.length === 0 ? 0 : (sorted[Math.ceil(0.95 * sorted.length) - 1] ?? 0);
      return {
        fps,
        frameP95Ms: p95,
        resolutionScale: governor.scale(),
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
      renderer?.dispose();
      renderer = null;
      canvas = null;
    },
  };
}
