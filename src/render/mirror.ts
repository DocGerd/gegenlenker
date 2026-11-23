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
import type { TruckSpec, Vec3 } from '../contracts/vehicle';
import { truckAnchors } from '../vehicles/anchors';
import { bodyToThree } from './coords';
import { CLASS_V } from './close-mirror';
import { closeMirrorMount, frontMirrorMount } from './mirror-fields';
import { QUALITY_FLAGS } from './quality';
import { CAMERA_FAR, enableLayers, MIRROR_LAYERS } from './seams';
import { FRONT_ASPECT, WIDE_ASPECT } from './viewports';

const NEAR = 0.2;
/** Class II mirrors look this far outward of straight back. */
export const MIRROR_YAW = MathUtils.degToRad(7);

/** One mirror's camera and capture schedule; angles in radians, `fov` in degrees (three's convention). */
export type MirrorSpec = {
  /** Where on the truck the camera sits (`mirrorMounts`). */
  readonly anchor: 'mirrorLeft' | 'mirrorRight' | 'wideLeft' | 'wideRight' | 'front' | 'close';
  /** The view rect the mirror fills. */
  readonly view: 'mirrorLeft' | 'mirrorRight' | 'wideLeft' | 'wideRight' | 'front' | 'close';
  /** From straight back; positive turns toward the truck's right. */
  readonly yaw: number;
  readonly pitch: number;
  readonly roll: number;
  /** Vertical field of view. */
  readonly fov: number;
  /** Width over height; null follows the target. */
  readonly aspect: number | null;
  /** Target resolution relative to the rect it fills. */
  readonly targetScale: number;
  /** Captures on frames where `frame % cadence === parity`. */
  readonly cadence: 1 | 2;
  readonly parity: 0 | 1;
};

const CLASS_II = {
  pitch: MathUtils.degToRad(-4),
  roll: 0,
  fov: 46,
  aspect: null,
  targetScale: 1,
  cadence: 1,
  parity: 0,
} as const;

export const CLASS_II_LEFT: MirrorSpec = {
  ...CLASS_II,
  anchor: 'mirrorLeft',
  view: 'mirrorLeft',
  yaw: -MIRROR_YAW,
};
export const CLASS_II_RIGHT: MirrorSpec = {
  ...CLASS_II,
  anchor: 'mirrorRight',
  view: 'mirrorRight',
  yaw: MIRROR_YAW,
};
export const CLASS_II_MIRRORS: readonly MirrorSpec[] = [CLASS_II_LEFT, CLASS_II_RIGHT];

/**
 * Class IV looks this far outward of straight back, and down: its field is the ground beside the
 * truck. It renders at the rect's full pixel ratio, and at half rate: each side on alternate frames.
 */
export const WIDE_YAW = MathUtils.degToRad(25);
const CLASS_IV = {
  pitch: MathUtils.degToRad(-18),
  roll: 0,
  fov: 64,
  aspect: WIDE_ASPECT,
  targetScale: 1,
  cadence: 2,
} as const;

/** Left captures on even frames and right on odd ones: one class IV pass per frame. */
export const CLASS_IV_LEFT: MirrorSpec = {
  ...CLASS_IV,
  anchor: 'wideLeft',
  view: 'wideLeft',
  yaw: -WIDE_YAW,
  parity: 0,
};
export const CLASS_IV_RIGHT: MirrorSpec = {
  ...CLASS_IV,
  anchor: 'wideRight',
  view: 'wideRight',
  yaw: WIDE_YAW,
  parity: 1,
};

/**
 * Class VI: from above the cab front, forward and down onto the ground ahead of the bumper. The
 * camera is rolled upside down, so the bumper lies on the image's top edge, and the composite's
 * mirrored u puts the driver's side on the left.
 */
export const CLASS_VI: MirrorSpec = {
  anchor: 'front',
  view: 'front',
  yaw: Math.PI,
  pitch: MathUtils.degToRad(-80),
  roll: Math.PI,
  fov: 48,
  aspect: FRONT_ASPECT,
  targetScale: 1,
  cadence: 1,
  parity: 0,
};

/** Class V: see `CLASS_V`; it hangs by the A-pillar on the passenger side. */
export const CLASS_V_MIRROR: MirrorSpec = { ...CLASS_V, anchor: 'close', view: 'close' };

/** Every mirror this build draws, in capture order; a mirror is captured when its view rect is shown. */
export const MIRRORS: readonly MirrorSpec[] = [
  ...CLASS_II_MIRRORS,
  CLASS_IV_LEFT,
  CLASS_IV_RIGHT,
  CLASS_VI,
  CLASS_V_MIRROR,
];

/** Where each mirror's camera sits on a truck, in the body frame. */
export type MirrorMounts = Readonly<Record<MirrorSpec['anchor'], Vec3>>;

export function mirrorMounts(truck: TruckSpec): MirrorMounts {
  const { mirrorLeft, mirrorRight, wideLeft, wideRight } = truckAnchors(truck);
  return {
    mirrorLeft,
    mirrorRight,
    wideLeft,
    wideRight,
    front: frontMirrorMount(truck),
    close: closeMirrorMount(truck),
  };
}

export const mirrorAnchor = (spec: MirrorSpec, mounts: MirrorMounts): Vec3 => mounts[spec.anchor];

/**
 * Writes the position of the mirror at the body-frame `anchor` of a truck at `pose` into `out` and
 * returns the world heading it looks along, `yaw` from straight back.
 */
export function mirrorFacing(pose: Pose2, anchor: Vec3, yaw: number, out: Vector3): number {
  bodyToThree(pose, anchor, out);
  return pose.heading + Math.PI + yaw;
}

/** `mirrorFacing` for a class II mirror on `side`. */
export const mirrorPose = (
  pose: Pose2,
  anchor: Vec3,
  side: 'left' | 'right',
  out: Vector3,
): number => mirrorFacing(pose, anchor, side === 'left' ? -MIRROR_YAW : MIRROR_YAW, out);

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
  if (spec.parity >= spec.cadence) throw new Error('mirror parity must be below its cadence');
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
  let invalid = false;

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
    /** Makes the next capture render whatever its frame: the picture is stale (rect hidden, scene or look changed). */
    invalidate(): void {
      invalid = true;
    },
    /**
     * Renders the scene into the target unless `frame` is off this mirror's cadence, which keeps the
     * last capture; a missing, resized or invalidated target always renders. Returns whether it rendered.
     */
    capture(
      renderer: WebGPURenderer,
      scene: Scene,
      widthPx: number,
      heightPx: number,
      sky: number,
      frame: number,
    ): boolean {
      const w = Math.max(1, Math.round(widthPx * spec.targetScale));
      const h = Math.max(1, Math.round(heightPx * spec.targetScale));
      let stale = invalid;
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
      invalid = false;
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
