import type { SignId } from '../contracts/einweiser';
import type { Pose2, SimSnapshot, Vec2 } from '../contracts/sim';
import type { MirrorId, Vec3 } from '../contracts/vehicle';
import { BRAKE_DECEL, DT } from '../sim/constants';
import { sweptBodies } from '../sim/predict';
import { bodyPoints, type Occluder, pointSight, type SightGeometry, sightOf } from './sight';
import { SIGN_POSES, signHandPoints } from './sign-poses';
import { overlaps } from './walk';

/**
 * The reading rules the driver and the derived faults share (`docs/einweiser-spike.md` §2, §5).
 * Estimates: no source gives a reaction time, a band, a tolerance or a range.
 */
export const REACTION_TIME = 0.7;
/** Half a cycle more for looping signs and Abstandsverringerung's closing movement. */
export const LOOP_RECOGNITION = 0.5;
/** Half width of the abeam band on the cab's transverse axis at the eye. */
export const ABEAM_HALF_WIDTH = 0.5;
/** Largest angle between his facing and his line to where he is seen. */
export const FACING_TOLERANCE = Math.PI / 3;
/** Farthest reading distance per path (m), from the eye or the mirror mount. */
export const READING_RANGE: Readonly<Record<'direct' | MirrorId, number>> = {
  direct: 40,
  mirrorLeft: 30,
  mirrorRight: 30,
  wideLeft: 15,
  wideRight: 15,
  close: 6,
  front: 6,
};
/** Forgiven losses of sight, summed since the vehicle last stood, stop it past this (s). */
export const GRACE_CAP = 1.5;
/** Added to the braking distance for the swept path he must stay out of (m). */
export const IN_PATH_MARGIN = 1;
/** Clearance to a body below this (m) while moving is `tooClose`. */
export const TOO_CLOSE = 0.5;

/** Hashed for Einweiser runs; order is part of the hash. */
export const EINWEISER_THRESHOLDS = {
  REACTION_TIME,
  LOOP_RECOGNITION,
  ABEAM_HALF_WIDTH,
  FACING_TOLERANCE,
  READING_RANGE,
  GRACE_CAP,
  IN_PATH_MARGIN,
  TOO_CLOSE,
} as const;

/** Signs that set the vehicle moving. */
export const MOVEMENT_SIGNS: ReadonlySet<SignId> = new Set<SignId>([
  'abfahren',
  'herkommen',
  'entfernen',
  'links',
  'rechts',
  'abstand',
]);

/** How long a sign (null: arms down) must show before the driver acts on it. */
export function recognitionTime(sign: SignId | null): number {
  if (sign === null || sign === 'haltGefahr' || SIGN_POSES[sign].motion === 'static') {
    return REACTION_TIME;
  }
  return REACTION_TIME + LOOP_RECOGNITION;
}

/** Distance from the sign to standstill at `speed` braking at `decel`. */
export const stoppingDistance = (speed: number, decel: number): number =>
  speed * REACTION_TIME + (speed * speed) / (2 * decel);

/** His side of the cab's transverse axis at the eye. */
export type Station = 'ahead' | 'behind' | 'abeam';

export function station(g: SightGeometry, truck: Pose2, at: Vec2): Station {
  const [c, s] = [Math.cos(truck.heading), Math.sin(truck.heading)];
  const along = c * (at.x - truck.x) + s * (at.y - truck.y) - g.eye.x;
  if (along > ABEAM_HALF_WIDTH) return 'ahead';
  if (along < -ABEAM_HALF_WIDTH) return 'behind';
  return 'abeam';
}

/** Whether he stands inside the swept bodies within the braking distance at the snapshot's speed plus the margin. */
export function inPath(g: SightGeometry, s: SimSnapshot, at: Vec2): boolean {
  const distance = stoppingDistance(Math.abs(s.speed), BRAKE_DECEL) + IN_PATH_MARGIN;
  return sweptBodies(g.params, s, distance).some((b) => overlaps(b.obb, at));
}

const toWorld = (pose: Pose2, p: Vec3): Vec3 => {
  const [c, s] = [Math.cos(pose.heading), Math.sin(pose.heading)];
  return { x: pose.x + c * p.x - s * p.y, y: pose.y + s * p.x + c * p.y, z: p.z };
};

/** The occluders near any line from the cab to him: the rest cannot block one. */
function near(g: SightGeometry, s: SimSnapshot, at: Vec2, occluders: readonly Occluder[]) {
  const ends = [at, toWorld(s.truck, g.eye), ...g.mirrors.map((m) => toWorld(s.truck, m.mount))];
  const pad = 1;
  const minX = Math.min(...ends.map((p) => p.x)) - pad;
  const maxX = Math.max(...ends.map((p) => p.x)) + pad;
  const minY = Math.min(...ends.map((p) => p.y)) - pad;
  const maxY = Math.max(...ends.map((p) => p.y)) + pad;
  return occluders.filter(({ obb }) => {
    const r = Math.hypot(obb.halfLength, obb.halfWidth);
    return obb.cx + r >= minX && obb.cx - r <= maxX && obb.cy + r >= minY && obb.cy - r <= maxY;
  });
}

/** What the driver takes in of him each step. */
export type Perception = {
  readonly inSight: boolean;
  readonly station: Station;
  /** He is in sight inside the swept path (`inPath`). */
  readonly inPath: boolean;
  /** Readability and facing of `sign`, judged at recognition only. */
  readonly judge: () => Judgement;
};
export type Judgement = { readonly readable: boolean; readonly facing: boolean };

export function perceive(
  g: SightGeometry,
  s: SimSnapshot,
  pose: Pose2,
  sign: SignId | null,
  occluders: readonly Occluder[],
): Perception {
  const local = near(g, s, pose, occluders);
  const sight = sightOf(g, s, bodyPoints(pose), local);
  const inSight = sight.direct || sight.mirrors.length > 0;
  return {
    inSight,
    station: station(g, s.truck, pose),
    inPath: inSight && inPath(g, s, pose),
    judge: () => judge(g, s, pose, sign, local),
  };
}

/** A sign is readable on a path that sees every hand point within that path's range; facing counts toward such a path. */
export function judge(
  g: SightGeometry,
  s: SimSnapshot,
  pose: Pose2,
  sign: SignId | null,
  occluders: readonly Occluder[],
): Judgement {
  if (sign === null) return { readable: true, facing: true };
  const hands = signHandPoints(pose, sign).map((p) => pointSight(g, s, p, occluders));
  const paths = [
    {
      range: READING_RANGE.direct,
      from: toWorld(s.truck, g.eye),
      seen: hands.every((h) => h.direct),
    },
    ...g.mirrors.map((m) => ({
      range: READING_RANGE[m.id],
      from: toWorld(s.truck, m.mount),
      seen: hands.every((h) => h.mirrors.includes(m.id)),
    })),
  ].filter((p) => p.seen && Math.hypot(p.from.x - pose.x, p.from.y - pose.y) <= p.range);
  const off = (from: Vec3): number => {
    const toward = Math.atan2(from.y - pose.y, from.x - pose.x) - pose.heading;
    return Math.abs(Math.atan2(Math.sin(toward), Math.cos(toward)));
  };
  return {
    readable: paths.length > 0,
    facing: paths.some((p) => off(p.from) <= FACING_TOLERANCE),
  };
}

/** One step's outcome of reading him. */
export type Reading =
  | { readonly kind: 'none' }
  /** The driver acts on `sign` (null: arms down), given from `station`. */
  | { readonly kind: 'recognised'; readonly sign: SignId | null; readonly station: Station }
  | { readonly kind: 'unclear'; readonly sign: SignId }
  /** A loss of sight it stops for. */
  | { readonly kind: 'lost' }
  /** It brakes for him in its path. */
  | { readonly kind: 'inPath' };

export type Reader = {
  /** `standing`: the vehicle's speed is 0. */
  read(sign: SignId | null, p: Perception, standing: boolean): Reading;
};

const steps = (seconds: number): number => Math.round(seconds / DT);
const NONE: Reading = { kind: 'none' };
const GEARED = new Set<SignId>(['links', 'rechts', 'abstand']);

/**
 * Recognition, the station rule and the lost-sight grace timer, shared by the driver and the derived
 * faults. A sign is recognised once it has shown, in sight, for its recognition time; a run of it begins
 * with the key, with sight returning, or (Herkommen, Entfernen) with his side of the cab axis changing.
 */
export function createReader(): Reader {
  const delay = steps(REACTION_TIME);
  const inPathLine = Array.from({ length: delay }, () => false);
  let slot = 0;
  let token: string | null = null;
  let run = 0;
  let fresh = true;
  let judged = false;
  let acted: string | null = null;
  let previous: SignId | null = null;
  let lost = 0;
  let forgiven = 0;
  let stopped = false;
  let returned = false;

  return {
    read(sign, p, standing) {
      if (standing) forgiven = 0;
      const delayedInPath = inPathLine[slot] ?? false;
      inPathLine[slot] = p.inPath;
      slot = (slot + 1) % delay;

      if (!p.inSight) {
        lost += 1;
        token = null;
        previous = sign;
        if (!stopped && (lost >= delay || forgiven + lost > steps(GRACE_CAP))) {
          stopped = true;
          acted = null;
          return { kind: 'lost' };
        }
        return NONE;
      }
      if (lost > 0) {
        if (!stopped) forgiven += lost;
        [lost, stopped, returned] = [0, false, true];
      }
      if (delayedInPath && !standing) {
        token = null;
        acted = null;
        return { kind: 'inPath' };
      }

      const here =
        sign === 'herkommen' || sign === 'entfernen' ? `${sign}@${p.station}` : String(sign);
      if (here !== token) {
        fresh = returned || sign !== previous || token === null;
        [token, run, judged] = [here, 0, false];
      }
      [previous, returned] = [sign, false];
      run += 1;
      if (judged || run < steps(recognitionTime(sign))) return NONE;
      judged = true;
      if (here === acted) return NONE;

      if (sign !== null) {
        const { readable, facing } = p.judge();
        const banded =
          p.station === 'abeam' &&
          (((sign === 'herkommen' || sign === 'entfernen') && fresh) ||
            (GEARED.has(sign) && standing));
        if (!readable || (MOVEMENT_SIGNS.has(sign) && !facing) || banded) {
          acted = null;
          return { kind: 'unclear', sign };
        }
      }
      acted = here;
      return { kind: 'recognised', sign, station: p.station };
    },
  };
}
