import type { SignId } from '../contracts/einweiser';
import type { Pose2 } from '../contracts/sim';
import type { Vec3 } from '../contracts/vehicle';

/**
 * Where an arm segment points in the Einweiser's frame (x his facing, y his left, z up): `out` is the
 * azimuth from his facing toward that arm's own side, `up` the elevation (−π/2 hangs, π/2 points up).
 */
export type Segment = { readonly out: number; readonly up: number };
export type ArmPose = { readonly upper: Segment; readonly fore: Segment };
export type BodyPose = { readonly left: ArmPose; readonly right: ArmPose };
/** `static` holds its one key, `loop` cycles its keys, `once` plays them and holds the last. */
export type SignMotion = 'static' | 'loop' | 'once';
/**
 * Where the signing palms face, as the source words it: toward the driver, toward the body (beckoning),
 * away from it, or toward each other; null where the source names none.
 */
export type Palm = 'forward' | 'inward' | 'outward' | 'facing';
export type SignPose = {
  readonly keys: readonly BodyPose[];
  readonly motion: SignMotion;
  /** The arms that give the sign; the driver must see their hands. */
  readonly arms: readonly ('left' | 'right')[];
  readonly palm: Palm | null;
};

/** Body measures, metres (estimates). */
export const SHOULDER_HEIGHT = 1.42;
export const SHOULDER_HALF_SPAN = 0.2;
export const UPPER_ARM = 0.31;
/** Elbow to the middle of the palm. */
export const FOREARM = 0.35;

const DEG = Math.PI / 180;
const seg = (out: number, up: number): Segment => ({ out: out * DEG, up: up * DEG });
const arm = (upper: Segment, fore: Segment = upper): ArmPose => ({ upper, fore });
const DOWN = arm(seg(0, -90));
const UP = arm(seg(0, 90));
const SIDEWAYS = arm(seg(90, 0));
const both = (pose: ArmPose): BodyPose => ({ left: pose, right: pose });

/** Arms down: no sign. */
export const ARMS_DOWN: BodyPose = both(DOWN);

const beckon = (fore: Segment): BodyPose => both(arm(seg(30, -20), fore));
const steer = (fore: Segment): ArmPose => arm(seg(80, 0), fore);
const close = (out: number): BodyPose => both(arm(seg(20, 0), seg(out, 0)));
/** Both hands before the chest on an imagined wheel, turned by `turn` degrees toward his left. */
const wheel = (turn: number): BodyPose => ({
  left: arm(seg(20, -40), seg(-40, -turn)),
  right: arm(seg(20, -40), seg(-40, turn)),
});
const steering = (turn: number): SignPose => ({
  keys: [wheel(0), wheel(turn)],
  motion: 'loop',
  arms: ['left', 'right'],
  palm: 'facing',
});

/**
 * The source poses of ASR A1.3 Anhang 2 as the driver sees them (the first-person view adapts them),
 * and the steering signs, which no source draws. Estimated angles; render slerps between the keys.
 */
export const SIGN_POSES: Readonly<Record<SignId, SignPose>> = {
  achtung: {
    keys: [{ left: DOWN, right: UP }],
    motion: 'static',
    arms: ['right'],
    palm: 'forward',
  },
  halt: { keys: [both(SIDEWAYS)], motion: 'static', arms: ['left', 'right'], palm: 'forward' },
  haltGefahr: {
    keys: [both(SIDEWAYS), both(arm(seg(90, 0), seg(0, 0)))],
    motion: 'loop',
    arms: ['left', 'right'],
    palm: 'forward',
  },
  abfahren: {
    keys: [
      { left: DOWN, right: arm(seg(90, 70)) },
      { left: DOWN, right: arm(seg(-90, 70)) },
    ],
    motion: 'loop',
    arms: ['right'],
    palm: 'forward',
  },
  herkommen: {
    keys: [beckon(seg(0, 10)), beckon(seg(0, 75))],
    motion: 'loop',
    arms: ['left', 'right'],
    palm: 'inward',
  },
  entfernen: {
    keys: [beckon(seg(0, 75)), beckon(seg(0, 10))],
    motion: 'loop',
    arms: ['left', 'right'],
    palm: 'outward',
  },
  links: {
    keys: [
      { left: steer(seg(100, 10)), right: DOWN },
      { left: steer(seg(50, 10)), right: DOWN },
    ],
    motion: 'loop',
    arms: ['left'],
    palm: null,
  },
  rechts: {
    keys: [
      { left: DOWN, right: steer(seg(100, 10)) },
      { left: DOWN, right: steer(seg(50, 10)) },
    ],
    motion: 'loop',
    arms: ['right'],
    palm: null,
  },
  abstand: {
    keys: [close(20), close(-10)],
    motion: 'once',
    arms: ['left', 'right'],
    palm: 'facing',
  },
  lenkenLinks: steering(25),
  lenkenLinksVoll: steering(60),
  lenkenGerade: { keys: [wheel(0)], motion: 'static', arms: ['left', 'right'], palm: 'facing' },
  lenkenRechts: steering(-25),
  lenkenRechtsVoll: steering(-60),
};

const direction = (s: Segment, side: 1 | -1): Vec3 => ({
  x: Math.cos(s.up) * Math.cos(s.out),
  y: side * Math.cos(s.up) * Math.sin(s.out),
  z: Math.sin(s.up),
});

/** The palm of `side`'s arm in `body`, in the world, for an Einweiser at `pose`. */
export function handPoint(pose: Pose2, body: BodyPose, side: 'left' | 'right'): Vec3 {
  const s = side === 'left' ? 1 : -1;
  const { upper, fore } = body[side];
  const u = direction(upper, s);
  const f = direction(fore, s);
  const x = UPPER_ARM * u.x + FOREARM * f.x;
  const y = s * SHOULDER_HALF_SPAN + UPPER_ARM * u.y + FOREARM * f.y;
  const [c, n] = [Math.cos(pose.heading), Math.sin(pose.heading)];
  return {
    x: pose.x + c * x - n * y,
    y: pose.y + n * x + c * y,
    z: SHOULDER_HEIGHT + UPPER_ARM * u.z + FOREARM * f.z,
  };
}

/** Every key's hand of every arm that gives `sign`: the points the driver must see to read it. */
export const signHandPoints = (pose: Pose2, sign: SignId): Vec3[] => {
  const { keys, arms } = SIGN_POSES[sign];
  return keys.flatMap((key) => arms.map((side) => handPoint(pose, key, side)));
};
