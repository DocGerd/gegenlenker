import type { SignallingMode, SignId } from '../contracts/einweiser';
import type { ControlVector, Pose2, SimSnapshot, Vec2 } from '../contracts/sim';
import { hasTrailer, type RigParams, type VehicleParams } from '../contracts/vehicle';
import { wrapAngle } from '../sim/angle';
import { V_MAX } from '../sim/constants';
import {
  couplingAngle,
  pivotViolation,
  rk4,
  turntableAngle,
  type KinematicState,
} from '../sim/kinematics';
import { createReader, type Perception, perceive, type Reading, type Station } from './signs';
import type { Occluder, SightGeometry } from './sight';

/**
 * Driver tuning (estimates). Not hashed: the driver's controls are logged, so changing them retires no
 * stored run. Creep stays below walking speed.
 */
export const CREEP_LEVER = 0.5;
export const CRAWL_LEVER = 0.15;
/**
 * Rechts/Links fahren curve the leading end at this radius (m): tighter forward, where the
 * combination follows, than in reverse, where the articulation must stay controllable.
 */
export const CURVE_RADIUS = { D: 8, R: 15 } as const;
/** Curvature change per metre of travel, so a curve eases in and out. */
const CURVE_SLEW = 0.05;
/** Forward: road-wheel radians per radian of heading error. */
const FORWARD_GAIN = 1;
/** Before moving off it turns the wheel to within this (normalised) of its target. */
const PRE_STEER = 0.05;
/** Reverse: the wheel command leads the planned wheel rate by this distance (m). */
const WHEEL_LEAD = 0.3;
/** Reverse state weights (heading, turntable, coupling, wheel) and the wheel-rate weight. */
const REVERSE_WEIGHTS = [1, 1, 1, 0.1] as const;
const REVERSE_RATE_WEIGHT = 1;
/** The wheel (normalised) for the steering signs: a little (owner), full lock. */
export const STEER_LITTLE = 0.5;
const STEER_FULL = 1;
/**
 * Steering mode (estimates): every `REFUSE_EVERY` steps it checks that, after `HOLD_AHEAD` m more with the
 * wheel it was given, full lock to one side could still unfold the combination in the same gear, and
 * turns the wheel back toward straight until it can; it halts where no share can.
 */
const REFUSE_EVERY = 15;
const REFUSE_STEPS = [1, 0.75, 0.5, 0.25, 0] as const;
/** The travel to the next check plus the stop from creep, with a margin. */
const HOLD_AHEAD = 0.6;
/** Below this share of a limit (the larger of the two angles) any wheel can still be undone. */
const FOLD_SAFE = 0.35;
/** Full lock unfolds once the fold falls this far below its peak (share of the limit) within `UNFOLD_WITHIN` m. */
const UNFOLD_BY = 0.03;
const UNFOLD_WITHIN = 10;
const ROLL_STEP = 0.1;

type Move = {
  readonly kind: 'move';
  readonly gear: 'D' | 'R';
  readonly lever: number;
  readonly curve: number;
  /** A steering sign's wheel; null keeps the wheel. */
  readonly wheel: number | null;
};
/** `halt`: lever to 0, brake at standstill; `brake`: brake at once. */
type Command = { readonly kind: 'halt' } | { readonly kind: 'brake' } | Move;

export type DriverStep = {
  readonly control: ControlVector;
  readonly perception: Perception;
  readonly reading: Reading;
};
export type Driver = {
  /** One fixed step: what it makes of the held pose and the shown sign, and the controls for the next sim step. */
  step(s: SimSnapshot, sign: SignId | null, pose: Pose2): DriverStep;
};
/** Acts on what the reader made of him: the commands, gear changes and steering. */
export type Pilot = {
  step(s: SimSnapshot, reading: Reading, pose: Pose2): ControlVector;
  /** An independent copy in the same state, to look ahead with. */
  fork(): Pilot;
};
type PilotState = {
  readonly gear: ControlVector['gear'];
  readonly command: Command;
  /** The leading end's heading it steers for. */
  readonly ref: number;
  readonly kappa: number;
  readonly lead: Vec2 | null;
  /** Steering mode: the wheel he signalled, and the share of it it drives with (null: it halts). */
  readonly given: number;
  readonly share: number | null;
  readonly sinceCheck: number;
  /** A refused wheel is checked once more at the standstill it halted to, turned as before moving off. */
  readonly restood: boolean;
};

type Matrix = readonly (readonly number[])[];
const times = (a: Matrix, b: Matrix): number[][] =>
  a.map((row) =>
    (b[0] ?? []).map((_, j) => row.reduce((sum, x, k) => sum + x * (b[k]?.[j] ?? 0), 0)),
  );
const transpose = (a: Matrix): number[][] =>
  (a[0] ?? []).map((_, j) => a.map((row) => row[j] ?? 0));

/**
 * State feedback for reversing, per metre of travel: an LQR on the articulation linearised about a
 * steady curve, with the wheel angle as a state and its rate as the input, so the gains respect the
 * steering rate. The state is the error in trailer heading, turntable, coupling and wheel angle.
 */
export function reverseGains(p: VehicleParams): number[] {
  const { wheelbase: L, couplingOffset: a, drawbar: D, trailerWheelbase: L2 } = p;
  const h = 0.05;
  const A: Matrix = [
    [1, -h / L2, 0, 0],
    [0, 1 + h / L2, -h / D, (h * a) / (L * D)],
    [0, 0, 1 + h / D, (-h * (D + a)) / (L * D)],
    [0, 0, 0, 1],
  ];
  const B = [0, 0, 0, h];
  const Q = REVERSE_WEIGHTS.map((q, i) => REVERSE_WEIGHTS.map((_, j) => (i === j ? q * h : 0)));
  const r = REVERSE_RATE_WEIGHT * h;
  let P: number[][] = Q.map((row) => [...row]);
  let K = [0, 0, 0, 0];
  // Joseph form: stays symmetric and positive definite where the plain recursion loses precision
  for (let i = 0; i < 4000; i++) {
    const PB = P.map((row) => row.reduce((sum, x, k) => sum + x * (B[k] ?? 0), 0));
    const BPB = B.reduce((sum, b, k) => sum + b * (PB[k] ?? 0), 0);
    const BPA = transpose(A).map((col) => col.reduce((sum, x, k) => sum + x * (PB[k] ?? 0), 0));
    K = BPA.map((x) => x / (r + BPB));
    const closed = A.map((row, m) => row.map((x, n) => x - (B[m] ?? 0) * (K[n] ?? 0)));
    const next = times(times(transpose(closed), P), closed);
    P = next.map((row, m) =>
      row.map((x, n) => (Q[m]?.[n] ?? 0) + x + r * (K[m] ?? 0) * (K[n] ?? 0)),
    );
  }
  return K;
}

const sideOf = (motion: number, toward: number): number => Math.sign(Math.sin(toward - motion));

/**
 * The wheel a steering sign asks for. Left and right are his own: the driver mirrors him by his facing
 * against the cab's heading, so facing the cab his left is the driver's right.
 */
export function signalledWheel(sign: SignId, truckHeading: number, pose: Pose2): number | null {
  const toward = (left: boolean, size: number): number =>
    size * sideOf(truckHeading, pose.heading + (left ? Math.PI / 2 : -Math.PI / 2));
  switch (sign) {
    case 'lenkenLinks':
      return toward(true, STEER_LITTLE);
    case 'lenkenLinksVoll':
      return toward(true, STEER_FULL);
    case 'lenkenRechts':
      return toward(false, STEER_LITTLE);
    case 'lenkenRechtsVoll':
      return toward(false, STEER_FULL);
    case 'lenkenGerade':
      return 0;
    default:
      return null;
  }
}

export const createPilot = (p: RigParams, mode: SignallingMode = 'tail'): Pilot =>
  pilotFrom(p, mode, hasTrailer(p) ? reverseGains(p) : [], {
    gear: 'P',
    command: { kind: 'halt' },
    ref: 0,
    kappa: 0,
    lead: null,
    given: 0,
    share: 1,
    sinceCheck: 0,
    restood: false,
  });

function pilotFrom(
  p: RigParams,
  mode: SignallingMode,
  gains: readonly number[],
  from: PilotState,
): Pilot {
  let { gear, command, ref, kappa, lead, given, share, sinceCheck, restood } = from;

  const leadingHeading = (s: SimSnapshot): number =>
    gear === 'D' ? s.truck.heading : s.trailer.heading;
  const leadingEnd = (s: SimSnapshot): Vec2 =>
    gear === 'D'
      ? {
          x: s.truck.x + p.truckFront * Math.cos(s.truck.heading),
          y: s.truck.y + p.truckFront * Math.sin(s.truck.heading),
        }
      : s.trailerRear;

  /** Herkommen's gear from his side of the cab axis. */
  const toward = (at: Station): 'D' | 'R' | null =>
    at === 'ahead' ? 'D' : at === 'behind' ? 'R' : null;

  function commandFor(sign: SignId | null, at: Station, s: SimSnapshot, pose: Pose2): Command {
    switch (sign) {
      case null:
      case 'achtung':
      case 'halt':
        return { kind: 'halt' };
      case 'haltGefahr':
        return { kind: 'brake' };
      case 'abfahren':
        return { kind: 'move', gear: 'D', lever: CREEP_LEVER, curve: 0, wheel: null };
      case 'herkommen':
      case 'entfernen': {
        const near = toward(at);
        if (near === null) return { kind: 'halt' };
        const away = near === 'D' ? 'R' : 'D';
        return {
          kind: 'move',
          gear: sign === 'herkommen' ? near : away,
          lever: CREEP_LEVER,
          curve: 0,
          wheel: null,
        };
      }
      case 'links':
      case 'rechts':
      case 'abstand':
      case 'lenkenLinks':
      case 'lenkenLinksVoll':
      case 'lenkenGerade':
      case 'lenkenRechts':
      case 'lenkenRechtsVoll': {
        const moving = s.speed !== 0 && (gear === 'D' || gear === 'R');
        const along = moving ? gear : toward(at);
        if (along !== 'D' && along !== 'R') return { kind: 'halt' };
        if (sign === 'abstand') {
          return { kind: 'move', gear: along, lever: CRAWL_LEVER, curve: 0, wheel: null };
        }
        if (sign !== 'links' && sign !== 'rechts') {
          const signalled = signalledWheel(sign, s.truck.heading, pose);
          return { kind: 'move', gear: along, lever: CREEP_LEVER, curve: 0, wheel: signalled };
        }
        const motion = along === 'D' ? s.truck.heading : s.trailer.heading + Math.PI;
        const indicated = pose.heading + (sign === 'links' ? Math.PI / 2 : -Math.PI / 2);
        const curve = sideOf(motion, indicated);
        return { kind: 'move', gear: along, lever: CREEP_LEVER, curve, wheel: null };
      }
    }
  }

  /** How far the combination is folded: the larger angle as a share of its limit. */
  const fold = (q: KinematicState): number =>
    hasTrailer(p)
      ? Math.max(
          Math.abs(couplingAngle(q)) / p.couplingLimit,
          Math.abs(turntableAngle(q)) / p.turntableLimit,
        )
      : 0;

  /**
   * Rolls `metres` at creep in `along` with the wheel easing toward `steer` at the steering rate; null at
   * a limit stop, or where `stop` holds.
   */
  function roll(
    from: { q: KinematicState; delta: number },
    along: 'D' | 'R',
    steer: number,
    metres: number,
    stop: (q: KinematicState) => boolean = () => false,
  ): { q: KinematicState; delta: number; stopped: boolean } | null {
    const ramp = (p.steerRate * p.maxRoadWheelAngle) / (CREEP_LEVER * V_MAX);
    const target = steer * p.maxRoadWheelAngle;
    let { q, delta } = from;
    for (let travelled = 0; travelled < metres - 1e-9; travelled += ROLL_STEP) {
      const gap = target - delta;
      const eased =
        Math.abs(gap) <= ramp * ROLL_STEP ? target : delta + Math.sign(gap) * ramp * ROLL_STEP;
      q = rk4(p, q, along === 'D' ? 1 : -1, (delta + eased) / 2, ROLL_STEP);
      delta = eased;
      if (pivotViolation(p, q) !== null) return null;
      if (stop(q)) return { q, delta, stopped: true };
    }
    return { q, delta, stopped: false };
  }

  /**
   * Whether full lock to either side, turned at a standstill there as before moving off (`PRE_STEER`),
   * unfolds it from `q` before a limit stop.
   */
  function unfolds(q: KinematicState, along: 'D' | 'R'): boolean {
    if (fold(q) <= FOLD_SAFE) return true;
    return [1, -1].some((lock) => {
      let peak = fold(q);
      const from = { q, delta: lock * p.maxRoadWheelAngle };
      const out = roll(from, along, lock, UNFOLD_WITHIN, (q) => {
        peak = Math.max(peak, fold(q));
        return fold(q) < peak - UNFOLD_BY;
      });
      return out?.stopped === true;
    });
  }

  /** The largest share of the given wheel, at most the last one, that it can still undo; null: none. */
  function allowedShare(s: SimSnapshot, along: 'D' | 'R', most: number): number | null {
    if (!hasTrailer(p)) return 1;
    const q = {
      x: s.truck.x,
      y: s.truck.y,
      th0: s.truck.heading,
      th1: s.dolly.heading,
      th2: s.trailer.heading,
    };
    for (const k of REFUSE_STEPS) {
      if (k > most) continue;
      // from a standstill it turns the wheel before moving off (`PRE_STEER`)
      const delta = s.speed === 0 ? k * given * p.maxRoadWheelAngle : s.roadWheelAngle;
      const ahead = roll({ q, delta }, along, k * given, HOLD_AHEAD);
      if (ahead !== null && unfolds(ahead.q, along)) return k;
    }
    return null;
  }

  function steerFor(s: SimSnapshot): number {
    if (mode === 'steering') return share === null ? s.control.steer : share * given;
    if (gear === 'D') {
      const delta =
        Math.atan(kappa * p.wheelbase) + FORWARD_GAIN * wrapAngle(ref - s.truck.heading);
      return Math.max(-1, Math.min(1, delta / p.maxRoadWheelAngle));
    }
    if (gear !== 'R') return 0;
    if (!hasTrailer(p)) {
      // solo, nothing articulates: the forward law with the motion reversed
      const delta =
        -Math.atan(kappa * p.wheelbase) - FORWARD_GAIN * wrapAngle(ref - s.truck.heading);
      return Math.max(-1, Math.min(1, delta / p.maxRoadWheelAngle));
    }
    // the steady curve at `kappa` (left turn of the leading rear positive), then the error from it
    const wheel = -Math.atan(kappa * p.wheelbase);
    const error = [
      wrapAngle(s.trailer.heading - ref),
      s.turntableAngle + kappa * p.trailerWheelbase,
      s.couplingAngle + kappa * (p.drawbar + p.couplingOffset),
      s.roadWheelAngle - wheel,
    ];
    const rate = -gains.reduce((sum, k, i) => sum + k * (error[i] ?? 0), 0);
    const target = s.roadWheelAngle + rate * WHEEL_LEAD;
    return Math.max(-1, Math.min(1, target / p.maxRoadWheelAngle));
  }

  return {
    step(s, reading, pose) {
      if (reading.kind === 'lost' || reading.kind === 'inPath') command = { kind: 'brake' };
      else if (reading.kind === 'unclear') command = { kind: 'halt' };
      else if (reading.kind === 'recognised') {
        command = commandFor(reading.sign, reading.station, s, pose);
        if (command.kind === 'move') {
          given = command.wheel ?? given;
          // a new sign may take the whole wheel again; until then the share only shrinks
          share = 1;
          sinceCheck = REFUSE_EVERY;
          restood = false;
        }
      }

      if (command.kind === 'move' && command.gear !== gear && s.speed === 0) {
        gear = command.gear;
        ref = leadingHeading(s);
        kappa = 0;
        lead = null;
      }
      const end = leadingEnd(s);
      const travelled = lead === null ? 0 : Math.hypot(end.x - lead.x, end.y - lead.y);
      lead = end;
      const goal =
        command.kind === 'move' && command.gear === gear ? command.curve / CURVE_RADIUS[gear] : 0;
      kappa += Math.max(-CURVE_SLEW * travelled, Math.min(CURVE_SLEW * travelled, goal - kappa));
      ref = wrapAngle(ref + kappa * travelled);
      if (mode === 'steering' && command.kind === 'move') {
        sinceCheck += 1;
        if (share === null && s.speed === 0 && !restood) {
          restood = true;
          share = allowedShare(s, command.gear, 1);
          sinceCheck = 0;
        } else if (sinceCheck >= REFUSE_EVERY) {
          if (share !== null) share = allowedShare(s, command.gear, share);
          sinceCheck = 0;
        }
      }
      // it refuses a wheel that would run into a limit stop: it halts with the wheel where it is
      if (mode === 'steering' && command.kind === 'move' && share === null) {
        return { steer: s.control.steer, lever: 0, brake: s.speed === 0, gear };
      }
      const steer = steerFor(s);

      const hold = (brake: boolean): ControlVector => ({ steer, lever: 0, brake, gear });
      if (command.kind === 'brake') return hold(true);
      if (command.kind === 'halt') return hold(s.speed === 0);
      if (command.gear !== gear) return hold(true);
      if (s.speed === 0 && Math.abs(s.steer - steer) > PRE_STEER) return hold(true);
      return { steer, lever: command.lever, brake: false, gear };
    },
    fork: () =>
      pilotFrom(p, mode, gains, {
        gear,
        command,
        ref,
        kappa,
        lead,
        given,
        share,
        sinceCheck,
        restood,
      }),
  };
}

/** The AI driver: perception and recognition (`signs.ts`) feeding the pilot. */
export function createDriver(
  g: SightGeometry,
  occluders: readonly Occluder[],
  pilot: Pilot = createPilot(g.params),
): Driver {
  const reader = createReader();
  return {
    step(s, sign, pose) {
      const perception = perceive(g, s, pose, sign, occluders);
      const reading = reader.read(sign, perception, s.speed === 0);
      return { control: pilot.step(s, reading, pose), perception, reading };
    },
  };
}
