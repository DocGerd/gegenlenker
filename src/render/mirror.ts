import {
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderTarget,
  type Vector3,
  type WebGLRenderer,
} from 'three';
import type { Rect } from '../contracts/render';

const FOV = 30;
const NEAR = 0.2;
const FAR = 400;
const PITCH = MathUtils.degToRad(-4);

/** One mirror: the scene is rendered unflipped into a target, then drawn with u → 1 − u. */
export function createMirror() {
  const camera = new PerspectiveCamera(FOV, 1, NEAR, FAR);
  camera.rotation.order = 'YXZ';

  const geometry = new PlaneGeometry(2, 2);
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
  const material = new MeshBasicMaterial({ depthTest: false, depthWrite: false });
  const quadScene = new Scene();
  quadScene.add(new Mesh(geometry, material));
  const quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  let target: WebGLRenderTarget | null = null;

  return {
    camera,
    /** `facing` is the world heading the mirror looks along. */
    place(position: Vector3, facing: number): void {
      camera.position.copy(position);
      camera.rotation.set(PITCH, facing - Math.PI / 2, 0);
    },
    capture(renderer: WebGLRenderer, scene: Scene, widthPx: number, heightPx: number): void {
      const w = Math.max(1, Math.round(widthPx));
      const h = Math.max(1, Math.round(heightPx));
      if (target === null) {
        target = new WebGLRenderTarget(w, h);
        material.map = target.texture;
        material.needsUpdate = true;
      } else if (target.width !== w || target.height !== h) {
        target.setSize(w, h);
      }
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
    },
    composite(renderer: WebGLRenderer, rect: Rect, cssHeight: number): void {
      const y = cssHeight - rect.y - rect.height;
      renderer.setViewport(rect.x, y, rect.width, rect.height);
      renderer.setScissor(rect.x, y, rect.width, rect.height);
      renderer.setScissorTest(true);
      renderer.render(quadScene, quadCamera);
    },
    dispose(): void {
      target?.dispose();
      target = null;
      geometry.dispose();
      material.dispose();
    },
  };
}

export type Mirror = ReturnType<typeof createMirror>;
