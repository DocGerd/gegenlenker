import {
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  RenderTarget,
  Scene,
  SRGBColorSpace,
  type Vector3,
} from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type { Pose2 } from '../contracts/sim';
import type { Vec3 } from '../contracts/vehicle';
import { bodyToThree } from './coords';
import { QUALITY_FLAGS } from './quality';
import { CAMERA_FAR, enableLayers, MIRROR_LAYERS } from './seams';

const FOV = 46;
const NEAR = 0.2;
const PITCH = MathUtils.degToRad(-4);
/** Each mirror looks this far outward of straight back. */
export const MIRROR_YAW = MathUtils.degToRad(7);

/**
 * Writes the position of the mirror at the body-frame `anchor` of a truck at `pose` into `out` and
 * returns the world heading it looks along.
 */
export function mirrorPose(
  pose: Pose2,
  anchor: Vec3,
  side: 'left' | 'right',
  out: Vector3,
): number {
  bodyToThree(pose, anchor, out);
  return pose.heading + Math.PI + (side === 'left' ? -MIRROR_YAW : MIRROR_YAW);
}

/** WebGPU takes 1 or 4 samples and WebGL 2 guarantees at least 4, so any request maps to 0 or 4. */
export const mirrorSamples = (requested: number): number => (requested >= 4 ? 4 : 0);

/**
 * One mirror: the scene is rendered unflipped into a target, then drawn with u → 1 − u. The target
 * reads back upside down (WebGPU texture origin on either backend), so v → 1 − v too.
 */
export function createMirror(requestedSamples = QUALITY_FLAGS.balanced.mirrorMsaa) {
  const camera = new PerspectiveCamera(FOV, 1, NEAR, CAMERA_FAR);
  camera.rotation.order = 'YXZ';
  enableLayers(camera.layers, MIRROR_LAYERS);

  const geometry = new PlaneGeometry(2, 2);
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 1 - uv.getX(i), 1 - uv.getY(i));
  const material = new MeshBasicMaterial({ depthTest: false, depthWrite: false });
  const quadScene = new Scene();
  quadScene.add(new Mesh(geometry, material));
  const quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  let target: RenderTarget | null = null;
  let samples = mirrorSamples(requestedSamples);

  return {
    camera,
    /** `facing` is the world heading the mirror looks along. */
    place(position: Vector3, facing: number): void {
      camera.position.copy(position);
      camera.rotation.set(PITCH, facing - Math.PI / 2, 0);
    },
    /** Takes effect on the next capture: the target is rebuilt because its samples are fixed at creation. */
    setSamples(requested: number): void {
      samples = mirrorSamples(requested);
      if (target === null || target.samples === samples) return;
      target.dispose();
      target = null;
      material.map = null;
    },
    capture(
      renderer: WebGPURenderer,
      scene: Scene,
      widthPx: number,
      heightPx: number,
      sky: number,
    ): void {
      const w = Math.max(1, Math.round(widthPx));
      const h = Math.max(1, Math.round(heightPx));
      if (target === null) {
        target = new RenderTarget(w, h, { samples, colorSpace: SRGBColorSpace });
        material.map = target.texture;
        material.needsUpdate = true;
      } else if (target.width !== w || target.height !== h) {
        target.setSize(w, h);
      }
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      // three resolves the clear colour against the target bound when it is set
      renderer.setRenderTarget(target);
      renderer.setClearColor(sky);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
    },
    /** Draws into the bound target, within the viewport it was given. */
    composite(renderer: WebGPURenderer): void {
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
