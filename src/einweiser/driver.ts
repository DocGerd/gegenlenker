import type { SignId } from '../contracts/einweiser';
import type { ControlVector, Pose2, SimSnapshot, Vec2 } from '../contracts/sim';
import { hasTrailer, type RigParams, type VehicleParams } from '../contracts/vehicle';
import { wrapAngle } from '../sim/angle';
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

type Move = {
  readonly kind: 'move';
  readonly gear: 'D' | 'R';
  readonly lever: number;
  readonly curve: number;
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

export const createPilot = (p: RigParams): Pilot =>
  pilotFrom(p, hasTrailer(p) ? reverseGains(p) : [], {
    gear: 'P',
    command: { kind: 'halt' },
    ref: 0,
    kappa: 0,
    lead: null,
  });

function pilotFrom(p: RigParams, gains: readonly number[], from: PilotState): Pilot {
  let { gear, command, ref, kappa, lead } = from;

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
        return { kind: 'move', gear: 'D', lever: CREEP_LEVER, curve: 0 };
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
        };
      }
      case 'links':
      case 'rechts':
      case 'abstand': {
        const moving = s.speed !== 0 && (gear === 'D' || gear === 'R');
        const along = moving ? gear : toward(at);
        if (along !== 'D' && along !== 'R') return { kind: 'halt' };
        if (sign === 'abstand') return { kind: 'move', gear: along, lever: CRAWL_LEVER, curve: 0 };
        const motion = along === 'D' ? s.truck.heading : s.trailer.heading + Math.PI;
        const indicated = pose.heading + (sign === 'links' ? Math.PI / 2 : -Math.PI / 2);
        return { kind: 'move', gear: along, lever: CREEP_LEVER, curve: sideOf(motion, indicated) };
      }
    }
  }

  function steerFor(s: SimSnapshot): number {
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
      const steer = steerFor(s);

      const hold = (brake: boolean): ControlVector => ({ steer, lever: 0, brake, gear });
      if (command.kind === 'brake') return hold(true);
      if (command.kind === 'halt') return hold(s.speed === 0);
      if (command.gear !== gear) return hold(true);
      if (s.speed === 0 && Math.abs(s.steer - steer) > PRE_STEER) return hold(true);
      return { steer, lever: command.lever, brake: false, gear };
    },
    fork: () => pilotFrom(p, gains, { gear, command, ref, kappa, lead }),
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
