import {
  type BufferGeometry,
  CapsuleGeometry,
  Color,
  Group,
  Mesh,
  PerspectiveCamera,
  SphereGeometry,
  Vector3,
} from 'three';
import { clamp, normalView, uniform, vertexColor } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import type { SignId } from '../contracts/einweiser';
import type { EinweiserVisual, Rect } from '../contracts/render';
import { LOOP_RECOGNITION } from '../einweiser/signs';
import {
  type ArmPose,
  type BodyPose,
  FOREARM,
  type Segment,
  SIGN_POSES,
  UPPER_ARM,
} from '../einweiser/sign-poses';
import { NIGHT_AMBIENT, NIGHT_TINT } from './light-rig';
import type { Look } from './look';
import { VIEWMODEL_LAYER } from './seams';
import { tint } from './tint';

/*
 * The Einweiser's own arms in his first-person view (`docs/einweiser-spike.md` §3.3): a view model
 * drawn by a camera of its own after his view, over a cleared depth, so they never clip into the
 * scene and keep their framing whatever his field of view. The poses are first-person versions of
 * `SIGN_POSES`: the source poses point sideways or straight up, out of any usable frame.
 */

/** Vertical field of view (degrees) of the view-model camera; estimate. */
const VIEWMODEL_FOV = 60;
/** The least horizontal half-angle (degrees): a narrower pane widens the vertical FOV instead. */
const VIEWMODEL_MIN_HALF_WIDTH = 30;
/** How far (NDC) the view offset lifts the picture, so the hands sit above the HUD band. */
const VIEWMODEL_LIFT = 0.35;
const VIEWMODEL_NEAR = 0.02;
const VIEWMODEL_FAR = 3;

/** One loop of a looping sign (s): the driver reads it after half of one (`LOOP_RECOGNITION`). */
export const SIGN_CYCLE = 2 * LOOP_RECOGNITION;
/** How long a press or release blends from the arms as drawn into the new sign (s; spike §1); estimate. */
export const SIGN_BLEND = 0.15;

/**
 * The view rig's shoulders from the eye (m; x ahead, y to that side, z up), estimates: a view-model
 * cheat ahead of the true shoulder, so the forearms and hands reach the frame from below its edges.
 */
const VIEW_SHOULDER = { ahead: 0.1, side: 0.2, up: -0.18 } as const;

/** Sleeve radii (m), estimates. */
const UPPER_RADIUS = 0.055;
const FORE_RADIUS = 0.045;
/** The glove's half extents across and along the forearm (m), estimates. */
const GLOVE_HALF = { across: 0.045, along: 0.075 } as const;

/** Hi-vis sleeve (EN ISO 20471 fluorescent yellow, sRGB approximation) and a dark work glove. */
const SLEEVE = 0xd2e000;
const GLOVE = 0x34342f;
/** The sleeve and glove at night: the night ambient, lifted a little by the yard's lamps; estimate. */
const NIGHT_LIFT = 3;

const DEG = Math.PI / 180;
const seg = (out: number, up: number): Segment => ({ out: out * DEG, up: up * DEG });
const arm = (upper: Segment, fore: Segment): ArmPose => ({ upper, fore });

/** An arm that gives no sign: lowered, its hand at the frame's lower edge. */
const LOWERED = arm(seg(0, -65), seg(-15, 40));

/** The signing arms' first-person keys, one per `SIGN_POSES` key, for the arms that give the sign. */
const FIRST_PERSON: Readonly<Record<SignId, readonly ArmPose[]>> = {
  // raised forward-up, not straight up
  achtung: [arm(seg(0, 20), seg(-5, 40))],
  // hands out to the sides at about ±25° azimuth, not straight sideways
  halt: [arm(seg(5, -15), seg(15, 15))],
  haltGefahr: [arm(seg(5, -15), seg(15, 15)), arm(seg(5, -15), seg(-10, 0))],
  abfahren: [arm(seg(0, 5), seg(15, 45)), arm(seg(0, 5), seg(-25, 45))],
  herkommen: [arm(seg(10, -35), seg(0, 10)), arm(seg(10, -35), seg(0, 60))],
  entfernen: [arm(seg(10, -35), seg(0, 60)), arm(seg(10, -35), seg(0, 10))],
  links: [arm(seg(0, -25), seg(20, 15)), arm(seg(0, -25), seg(-15, 15))],
  rechts: [arm(seg(0, -25), seg(20, 15)), arm(seg(0, -25), seg(-15, 15))],
  abstand: [arm(seg(5, -25), seg(10, 5)), arm(seg(5, -25), seg(-20, 5))],
};

const ARMS_DOWN_KEYS: readonly BodyPose[] = [{ left: LOWERED, right: LOWERED }];

/** The first-person keys of `sign` (null: arms down): the signing arms as `FIRST_PERSON`, the others lowered. */
export function firstPersonKeys(sign: SignId | null): readonly BodyPose[] {
  if (sign === null) return ARMS_DOWN_KEYS;
  const { arms } = SIGN_POSES[sign];
  return FIRST_PERSON[sign].map((pose) => ({
    left: arms.includes('left') ? pose : LOWERED,
    right: arms.includes('right') ? pose : LOWERED,
  }));
}

/** Where between which keys `phase` s into `sign` falls: a loop cycles once per `SIGN_CYCLE`, `once` plays its keys in half of one. */
function keyAt(sign: SignId | null, phase: number): { from: number; to: number; t: number } {
  const count = firstPersonKeys(sign).length;
  if (sign === null || count === 1) return { from: 0, to: 0, t: 0 };
  const motion = SIGN_POSES[sign].motion;
  if (motion === 'once') {
    const u = Math.min(Math.max(phase, 0) / LOOP_RECOGNITION, 1) * (count - 1);
    const from = Math.min(Math.floor(u), count - 2);
    return { from, to: from + 1, t: u - from };
  }
  const cycles = Math.max(phase, 0) / SIGN_CYCLE;
  const u = (cycles - Math.floor(cycles)) * count;
  const from = Math.floor(u) % count;
  return { from, to: (from + 1) % count, t: u - Math.floor(u) };
}

/** A segment's unit direction in the view: x right, y up, z toward the eye (Three's camera frame). */
function direction(s: Segment, side: 1 | -1, out: Vector3): Vector3 {
  const ahead = Math.cos(s.up) * Math.cos(s.out);
  const across = side * Math.cos(s.up) * Math.sin(s.out);
  return out.set(across, Math.sin(s.up), -ahead);
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Slerps the unit vectors `a` toward `b` by `t` into `a`. */
function slerp(a: Vector3, b: Vector3, t: number): Vector3 {
  const angle = a.angleTo(b);
  if (angle < 1e-6) return a;
  const s = Math.sin(angle);
  const wa = Math.sin((1 - t) * angle) / s;
  const wb = Math.sin(t * angle) / s;
  return a.multiplyScalar(wa).addScaledVector(b, wb);
}

/** The view-space joints of one arm (camera at the origin looking down −z). */
export type ArmPoints = {
  readonly shoulder: Vector3;
  readonly elbow: Vector3;
  readonly upper: Vector3;
  readonly fore: Vector3;
  /** The middle of the palm, `FOREARM` from the elbow. */
  readonly hand: Vector3;
};

/**
 * The joints of `side`'s arm at `phase` s into `sign` (null: arms down), slerped between its keys;
 * with `blendFrom`, the arm as drawn when the sign cut in, blended from it over `SIGN_BLEND`.
 */
export function armPoints(
  sign: SignId | null,
  phase: number,
  side: 'left' | 'right',
  blendFrom?: Pick<ArmPoints, 'upper' | 'fore'>,
): ArmPoints {
  const keys = firstPersonKeys(sign);
  const { from, to, t } = keyAt(sign, phase);
  const s = side === 'right' ? 1 : -1;
  const a = keys[from]?.[side];
  const b = keys[to]?.[side];
  if (a === undefined || b === undefined)
    throw new Error(`no key ${String(from)} of ${String(sign)}`);
  const k = smooth(t);
  const upper = slerp(
    direction(a.upper, s, new Vector3()),
    direction(b.upper, s, new Vector3()),
    k,
  );
  const fore = slerp(direction(a.fore, s, new Vector3()), direction(b.fore, s, new Vector3()), k);
  if (blendFrom !== undefined && phase < SIGN_BLEND) {
    const j = smooth(Math.max(phase, 0) / SIGN_BLEND);
    upper.copy(slerp(blendFrom.upper.clone(), upper, j));
    fore.copy(slerp(blendFrom.fore.clone(), fore, j));
  }
  const shoulder = new Vector3(s * VIEW_SHOULDER.side, VIEW_SHOULDER.up, -VIEW_SHOULDER.ahead);
  const elbow = shoulder.clone().addScaledVector(upper, UPPER_ARM);
  const hand = elbow.clone().addScaledVector(fore, FOREARM);
  return { shoulder, elbow, upper, fore, hand };
}

/** Fits the view-model camera to `pane`: `VIEWMODEL_FOV` tall, widened where the pane is narrow, lifted by `VIEWMODEL_LIFT`. */
export function placeViewModelCamera(
  camera: PerspectiveCamera,
  pane: Pick<Rect, 'width' | 'height'>,
): void {
  const aspect = pane.width / pane.height;
  const halfHeight = Math.max(
    Math.tan((VIEWMODEL_FOV * DEG) / 2),
    Math.tan(VIEWMODEL_MIN_HALF_WIDTH * DEG) / aspect,
  );
  camera.fov = (2 * Math.atan(halfHeight)) / DEG;
  // the window slides down the full view by half the lift's share of its height: the picture moves up
  // (`setViewOffset` also sets the aspect)
  const { width, height } = pane;
  camera.setViewOffset(width, height, 0, (VIEWMODEL_LIFT / 2) * height, width, height);
  camera.updateMatrixWorld();
}

export function createViewModelCamera(): PerspectiveCamera {
  const camera = new PerspectiveCamera(VIEWMODEL_FOV, 1, VIEWMODEL_NEAR, VIEWMODEL_FAR);
  // `enableLayers` only adds, and every camera sees the default layer: the scene would draw again
  camera.layers.set(VIEWMODEL_LAYER);
  return camera;
}

export type EinweiserArms = {
  /** Both arms, in the view-model camera's frame; hidden without a visual. */
  readonly object: Group;
  readonly camera: PerspectiveCamera;
  /** Poses the arms for `visual`; hidden without one: a driver run or a replay. */
  update(visual: EinweiserVisual | undefined): void;
  setLook(look: Look): void;
  dispose(): void;
};

const ALONG = new Vector3(0, 1, 0);

/** Places `mesh`, built along +y about its centre, from `from` along `dir` by `length`. */
function lay(mesh: Mesh, from: Vector3, dir: Vector3, length: number): void {
  mesh.position.copy(from).addScaledVector(dir, length / 2);
  mesh.quaternion.setFromUnitVectors(ALONG, dir);
}

export function createEinweiserArms(): EinweiserArms {
  const look = uniform(new Color(1, 1, 1));
  const shade = clamp(normalView.y.mul(0.2).add(normalView.z.mul(0.2)).add(0.7), 0, 1);
  const material = new MeshBasicNodeMaterial({ fog: false, toneMapped: false });
  material.colorNode = vertexColor().mul(shade).mul(look);

  const sleeve = new Color(SLEEVE);
  const glove = new Color(GLOVE);
  const upperGeometry = tint(new CapsuleGeometry(UPPER_RADIUS, UPPER_ARM, 3, 10), sleeve);
  const foreGeometry = tint(
    new CapsuleGeometry(FORE_RADIUS, FOREARM - GLOVE_HALF.along, 3, 10),
    sleeve,
  );
  const gloveGeometry = tint(
    new SphereGeometry(1, 10, 8).scale(GLOVE_HALF.across, GLOVE_HALF.along, GLOVE_HALF.across),
    glove,
  );
  const part = (geometry: BufferGeometry): Mesh => {
    const mesh = new Mesh(geometry, material);
    mesh.layers.set(VIEWMODEL_LAYER);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    // posed every frame next to the eye: culling would only cost the bounds
    mesh.frustumCulled = false;
    return mesh;
  };
  const group = new Group();
  group.visible = false;
  const sides = (['left', 'right'] as const).map((side) => {
    const upper = part(upperGeometry);
    const fore = part(foreGeometry);
    const hand = part(gloveGeometry);
    group.add(upper, fore, hand);
    return { side, upper, fore, hand };
  });
  group.layers.set(VIEWMODEL_LAYER);
  const camera = createViewModelCamera();
  let shown: Pick<EinweiserVisual, 'sign' | 'phase'> | null = null;
  const drawn = new Map<'left' | 'right', ArmPoints>();
  const cutFrom = new Map<'left' | 'right', ArmPoints>();

  return {
    object: group,
    camera,
    update(visual) {
      group.visible = visual !== undefined;
      if (visual === undefined) {
        shown = null;
        return;
      }
      if (shown === null) cutFrom.clear();
      else if (visual.sign !== shown.sign || visual.phase < shown.phase) {
        for (const [side, p] of drawn) cutFrom.set(side, p);
      }
      shown = { sign: visual.sign, phase: visual.phase };
      for (const { side, upper, fore, hand } of sides) {
        const p = armPoints(visual.sign, visual.phase, side, cutFrom.get(side));
        drawn.set(side, p);
        lay(upper, p.shoulder, p.upper, UPPER_ARM);
        lay(fore, p.elbow, p.fore, FOREARM - GLOVE_HALF.along);
        hand.position.copy(p.hand);
        hand.quaternion.setFromUnitVectors(ALONG, p.fore);
      }
    },
    setLook({ mode }) {
      const lift = mode === 'night' ? NIGHT_AMBIENT * NIGHT_LIFT : 1;
      const [r, g, b] = mode === 'night' ? NIGHT_TINT : [1, 1, 1];
      look.value.setRGB(r * lift, g * lift, b * lift);
    },
    dispose() {
      for (const g of [upperGeometry, foreGeometry, gloveGeometry]) g.dispose();
      material.dispose();
    },
  };
}
