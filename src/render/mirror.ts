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
import type { TruckAnchors, Vec3 } from '../contracts/vehicle';
import { bodyToThree } from './coords';
import { QUALITY_FLAGS } from './quality';
import { CAMERA_FAR, enableLayers, MIRROR_LAYERS } from './seams';

const NEAR = 0.2;
/** Class II mirrors look this far outward of straight back. */
export const MIRROR_YAW = MathUtils.degToRad(7);

/** One mirror's camera and capture schedule; angles in radians, `fov` in degrees (three's convention). */
export type MirrorSpec = {
  /** The body-frame anchor the camera sits at. */
  readonly anchor: 'mirrorLeft' | 'mirrorRight';
  readonly side: 'left' | 'right';
  /** Outward of straight back. */
  readonly yaw: number;
  readonly pitch: number;
  readonly roll: number;
  /** Vertical field of view. */
  readonly fov: number;
  /** Width over height; null follows the target. */
  readonly aspect: number | null;
  /** Target resolution relative to the rect it fills. */
  readonly targetScale: number;
  /** Captures every `cadence`-th frame, on frames where `frame % cadence === parity`. */
  readonly cadence: number;
  readonly parity: number;
};

const CLASS_II = {
  yaw: MIRROR_YAW,
  pitch: MathUtils.degToRad(-4),
  roll: 0,
  fov: 46,
  aspect: null,
  targetScale: 1,
  cadence: 1,
  parity: 0,
} as const;

export const CLASS_II_LEFT: MirrorSpec = { ...CLASS_II, anchor: 'mirrorLeft', side: 'left' };
export const CLASS_II_RIGHT: MirrorSpec = { ...CLASS_II, anchor: 'mirrorRight', side: 'right' };
export const CLASS_II_MIRRORS: readonly MirrorSpec[] = [CLASS_II_LEFT, CLASS_II_RIGHT];

export const mirrorAnchor = (spec: MirrorSpec, anchors: TruckAnchors): Vec3 => anchors[spec.anchor];

/**
 * Writes the position of the mirror at the body-frame `anchor` of a truck at `pose` into `out` and
 * returns the world heading it looks along.
 */
export function mirrorPose(
  pose: Pose2,
  anchor: Vec3,
  side: 'left' | 'right',
  out: Vector3,
  yaw = MIRROR_YAW,
): number {
  bodyToThree(pose, anchor, out);
  return pose.heading + Math.PI + (side === 'left' ? -yaw : yaw);
}

/** WebGPU takes 1 or 4 samples and WebGL 2 guarantees at least 4, so any request maps to 0 or 4. */
export const mirrorSamples = (requested: number): number => (requested >= 4 ? 4 : 0);

/**
 * One mirror: the scene is rendered unflipped into a target, then drawn with u → 1 − u. The target
 * reads back upside down (WebGPU texture origin on either backend), so v → 1 − v too.
 */
export function createMirror(
  spec: MirrorSpec = CLASS_II_LEFT,
  requestedSamples = QUALITY_FLAGS.balanced.mirrorMsaa,
) {
  const camera = new PerspectiveCamera(spec.fov, 1, NEAR, CAMERA_FAR);
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
    spec,
    /** `facing` is the world heading the mirror looks along. */
    place(position: Vector3, facing: number): void {
      camera.position.copy(position);
      camera.rotation.set(spec.pitch, facing - Math.PI / 2, spec.roll);
    },
    /** Takes effect on the next capture: the target is rebuilt because its samples are fixed at creation. */
    setSamples(requested: number): void {
      samples = mirrorSamples(requested);
      if (target === null || target.samples === samples) return;
      target.dispose();
      target = null;
      material.map = null;
    },
    /**
     * Renders the scene into the target unless `frame` is off this mirror's cadence, which keeps the
     * last capture; a missing or resized target always renders. Returns whether it rendered.
     */
    capture(
      renderer: WebGPURenderer,
      scene: Scene,
      widthPx: number,
      heightPx: number,
      sky: number,
      frame = 0,
    ): boolean {
      const w = Math.max(1, Math.round(widthPx * spec.targetScale));
      const h = Math.max(1, Math.round(heightPx * spec.targetScale));
      let stale = false;
      if (target === null) {
        target = new RenderTarget(w, h, { samples, colorSpace: SRGBColorSpace });
        material.map = target.texture;
        material.needsUpdate = true;
        stale = true;
      } else if (target.width !== w || target.height !== h) {
        target.setSize(w, h);
        stale = true;
      }
      if (!stale && frame % spec.cadence !== spec.parity) return false;
      camera.aspect = spec.aspect ?? w / h;
      camera.updateProjectionMatrix();
      // three resolves the clear colour against the target bound when it is set. The clear is part of
      // the render pass: a clear of its own would resolve the multisample target once more.
      const autoClear = renderer.autoClear;
      renderer.setRenderTarget(target);
      renderer.setClearColor(sky);
      renderer.autoClear = true;
      renderer.render(scene, camera);
      renderer.autoClear = autoClear;
      renderer.setRenderTarget(null);
      return true;
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
