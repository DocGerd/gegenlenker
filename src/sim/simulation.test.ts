import { describe, expect, it } from 'vitest';
import type {
  ContactQuery,
  ControlVector,
  Prediction,
  Simulation,
  SimSnapshot,
  StartState,
  Vec2,
} from '../contracts/sim';
import type { VehicleParams } from '../contracts/vehicle';
import { resolveCombination } from '../vehicles/resolve';
import { trailerById, trailers, truckById, trucks } from '../vehicles/registry';
import { wrapAngle } from './angle';
import { advanceClock } from './clock';
import { createContactQuery } from './collision';
import {
  ACCEL,
  BRAKE_DECEL,
  DECEL,
  DT,
  MAX_STEPS_PER_FRAME,
  EVENT_CLEAR_DISTANCE,
  PREDICT_DISTANCE,
  PREDICT_STEP,
  V_MAX,
} from './constants';
import { bodyFootprints } from './geometry';
import { NO_PREDICTION, predictCombination } from './predict';
import { createSimulation } from './simulation';

const CAP = 100_000;
const deg = (d: number): number => (d * Math.PI) / 180;
const origin: StartState = { truck: { x: 0, y: 0, heading: 0 } };
const noContacts: ContactQuery = () => null;
const open = (p: VehicleParams): VehicleParams => ({
  ...p,
  couplingLimit: 3.1,
  turntableLimit: 3.1,
});
const manKrone = (): VehicleParams =>
  resolveCombination(truckById('man-le-18-280'), trailerById('krone-azw-18'));
const pairs = trucks.flatMap((truck) =>
  trailers.map((trailer) => ({ truck, trailer, p: resolveCombination(truck, trailer) })),
);

const ctl = (c: Partial<ControlVector>): ControlVector => ({
  steer: 0,
  lever: 0,
  brake: false,
  gear: 'D',
  ...c,
});

const last = <T>(xs: readonly T[]): T => {
  const x = xs[xs.length - 1];
  if (x === undefined) throw new Error('empty');
  return x;
};

const drive = (sim: Simulation, control: ControlVector, steps: number): SimSnapshot[] =>
  Array.from({ length: steps }, () => sim.step(control));

const driveUntil = (
  sim: Simulation,
  control: ControlVector | ((s: SimSnapshot) => ControlVector),
  done: (s: SimSnapshot) => boolean,
): SimSnapshot[] => {
  const out: SimSnapshot[] = [];
  let s = sim.snapshot();
  for (let i = 0; i < CAP && !done(s); i++) {
    s = sim.step(typeof control === 'function' ? control(s) : control);
    out.push(s);
  }
  return out;
};

/** Drives until the truck rear axle has travelled `metres`; returns the snapshots with their distances. */
const driveDistance = (
  sim: Simulation,
  control: ControlVector | ((s: SimSnapshot) => ControlVector),
  metres: number,
): { snaps: SimSnapshot[]; dist: number[] } => {
  const snaps: SimSnapshot[] = [];
  const dist: number[] = [];
  let prev = sim.snapshot();
  let travelled = 0;
  for (let i = 0; i < CAP && travelled < metres; i++) {
    const s = sim.step(typeof control === 'function' ? control(prev) : control);
    travelled += Math.hypot(s.truck.x - prev.truck.x, s.truck.y - prev.truck.y);
    snaps.push(s);
    dist.push(travelled);
    prev = s;
  }
  expect(travelled).toBeGreaterThanOrEqual(metres);
  return { snaps, dist };
};

const settleSteer = (sim: Simulation, steer: number): void => {
  driveUntil(sim, ctl({ steer }), (s) => s.steer === steer);
};

const u = (h: number): Vec2 => ({ x: Math.cos(h), y: Math.sin(h) });
const n = (h: number): Vec2 => ({ x: -Math.sin(h), y: Math.cos(h) });
const dist2 = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

describe('simulation', () => {
  it('full lock reproduces each truck’s sourced turning radius', () => {
    for (const truck of trucks) {
      const p = resolveCombination(truck, trailerById('krone-azw-18'));
      const sim = createSimulation(p, origin, noContacts);
      settleSteer(sim, 1);
      const wheel = (s: SimSnapshot): Vec2 => {
        const f = u(s.truck.heading);
        const l = n(s.truck.heading);
        return {
          x: s.truck.x + p.wheelbase * f.x - (p.frontTrack / 2) * l.x,
          y: s.truck.y + p.wheelbase * f.y - (p.frontTrack / 2) * l.y,
        };
      };
      let prev = sim.snapshot();
      const wheels = [wheel(prev)];
      let turned = 0;
      for (let i = 0; i < CAP && turned < 1.2 * 2 * Math.PI; i++) {
        const s = sim.step(ctl({ steer: 1, lever: 1 }));
        turned += wrapAngle(s.truck.heading - prev.truck.heading);
        wheels.push(wheel(s));
        prev = s;
      }
      expect(prev.blocked).toBeNull();
      let diameter = 0;
      for (const a of wheels) for (const b of wheels) diameter = Math.max(diameter, dist2(a, b));
      const radius = diameter / 2;
      expect(Math.abs(radius - truck.turningRadius.value / 1000)).toBeLessThan(0.02);
    }
  });

  it('a sustained full-lock forward circle raises no jackknife event', () => {
    for (const { truck, trailer, p } of pairs) {
      // MAN + Hüffermann has no full-lock steady state: its dolly-axle circle is smaller than the trailer wheelbase.
      const steer =
        truck.id === 'man-le-18-280' && trailer.id === 'hueffermann-hpa-24-81-l' ? 0.9 : 1;
      const sim = createSimulation(p, origin, noContacts);
      const { snaps } = driveDistance(sim, ctl({ steer, lever: 1 }), 300);
      const end = last(snaps);
      expect(end.jackknifes).toBe(0);
      expect(end.blocked).toBeNull();
    }
  });

  it('coupling and turntable constraints hold forward and reverse', () => {
    for (const { p } of pairs) {
      const sim = createSimulation(p, origin, noContacts);
      const control =
        (gear: 'D' | 'R', amplitude: number) =>
        (s: SimSnapshot): ControlVector =>
          ctl({ steer: amplitude * Math.sin(0.8 * s.time), lever: 1, gear });
      const initial = sim.snapshot();
      const forward = driveDistance(sim, control('D', 0.6), 15).snaps;
      // Open-loop reversing folds a two-pivot trailer, so the reverse leg steers gently and stays short.
      const reverse = driveDistance(sim, control('R', 0.15), 8).snaps;
      expect(last(reverse).jackknifes).toBe(0);
      const snaps = [initial, ...forward, ...reverse];
      const slip = (a: { x: number; y: number; heading: number }, b: typeof a): number => {
        const mid = n(a.heading + wrapAngle(b.heading - a.heading) / 2);
        return Math.abs(((b.x - a.x) * mid.x + (b.y - a.y) * mid.y) / DT);
      };
      let prev: SimSnapshot | null = null;
      for (const s of snaps) {
        expect(Math.abs(dist2(s.coupling, s.dolly) - p.drawbar)).toBeLessThan(1e-9);
        expect(Math.abs(dist2(s.dolly, s.trailer) - p.trailerWheelbase)).toBeLessThan(1e-9);
        const f = u(s.truck.heading);
        expect(Math.abs(s.coupling.x - (s.truck.x - p.couplingOffset * f.x))).toBeLessThan(1e-9);
        expect(Math.abs(s.coupling.y - (s.truck.y - p.couplingOffset * f.y))).toBeLessThan(1e-9);
        if (prev) {
          expect(slip(prev.dolly, s.dolly)).toBeLessThan(1e-3);
          expect(slip(prev.trailer, s.trailer)).toBeLessThan(1e-3);
        }
        prev = s;
      }
    }
  });

  it('straight reversing with a small disturbance diverges', () => {
    const sim = createSimulation(manKrone(), { ...origin, turntableAngle: deg(0.5) }, noContacts);
    const { snaps } = driveDistance(sim, ctl({ lever: 1, gear: 'R' }), 10);
    expect(Math.abs(last(snaps).turntableAngle)).toBeGreaterThan(deg(2.5));
  });

  it('straight forward driving damps the same disturbance', () => {
    const sim = createSimulation(manKrone(), { ...origin, couplingAngle: deg(2) }, noContacts);
    const end = last(driveDistance(sim, ctl({ lever: 1 }), 30).snaps);
    expect(Math.abs(end.couplingAngle)).toBeLessThan(deg(0.2));
    expect(Math.abs(end.turntableAngle)).toBeLessThan(deg(0.2));
  });

  const jackknifed = (): { sim: Simulation; p: VehicleParams; at: SimSnapshot } => {
    const p = manKrone();
    const sim = createSimulation(p, origin, noContacts);
    const at = last(
      driveUntil(sim, ctl({ steer: 1, lever: 1, gear: 'R' }), (s) => s.blocked !== null),
    );
    return { sim, p, at };
  };

  it('exceeding a pivot limit rejects the step, stops and counts one event', () => {
    const { p, at } = jackknifed();
    expect(['coupling', 'turntable']).toContain(at.blocked);
    expect(at.jackknifes).toBe(1);
    expect(at.speed).toBe(0);
    if (at.blocked === 'coupling') {
      expect(Math.abs(at.couplingAngle)).toBeLessThanOrEqual(p.couplingLimit);
    } else {
      expect(Math.abs(at.turntableAngle)).toBeLessThanOrEqual(p.turntableLimit);
    }
  });

  it('pushing on while blocked keeps the vehicle still and counts one event', () => {
    const { sim, at } = jackknifed();
    const pushed = drive(sim, ctl({ steer: 1, lever: 1, gear: 'R' }), 120);
    for (const s of pushed) {
      expect(s.truck).toEqual(at.truck);
      expect(s.jackknifes).toBe(1);
    }
    const end = last(drive(sim, ctl({ steer: 1, lever: 1 }), 60));
    expect(dist2(end.truck, at.truck)).toBeGreaterThan(0);
    expect(end.blocked).toBeNull();
    expect(end.jackknifes).toBe(1);
  });

  it('steering out of a blocked pivot at standstill frees the same direction without a new event', () => {
    const p = { ...manKrone(), couplingLimit: deg(10) };
    const sim = createSimulation(p, origin, noContacts);
    const at = last(
      driveUntil(sim, ctl({ steer: 1, lever: 1, gear: 'R' }), (s) => s.blocked !== null),
    );
    expect(at.blocked).toBe('coupling');
    const turning = driveUntil(sim, ctl({ steer: -1, gear: 'R' }), (s) => s.steer === -1);
    for (const s of turning) expect(s.truck).toEqual(at.truck);
    const freed = driveUntil(
      sim,
      ctl({ steer: -1, lever: 1, gear: 'R' }),
      (s) => dist2(s.truck, at.truck) > 0.3,
    );
    expect(dist2(last(freed).truck, at.truck)).toBeGreaterThan(0.3);
    for (const s of freed) expect(s.jackknifes).toBe(1);
  });

  const expectHeld = (snaps: readonly SimSnapshot[], at: SimSnapshot): void => {
    for (const s of snaps) {
      if (s.blocked !== null) expect(s.truck).toEqual(at.truck);
      expect(s.jackknifes).toBe(1);
    }
  };

  it('sweeping the wheel with the lever held stays in one episode until the fold eases', () => {
    const p = { ...manKrone(), couplingLimit: deg(10) };
    const sim = createSimulation(p, origin, noContacts);
    const at = last(
      driveUntil(sim, ctl({ steer: 1, lever: 1, gear: 'R' }), (s) => s.blocked !== null),
    );
    const sweep = driveUntil(
      sim,
      ctl({ steer: -1, lever: 1, gear: 'R' }),
      (s) => dist2(s.truck, at.truck) > 0.3,
    );
    expect(dist2(last(sweep).truck, at.truck)).toBeGreaterThan(0.3);
    expectHeld(sweep, at);
  });

  it('opposite lock that only slows the fold keeps the jackknife until driving forward', () => {
    const { sim, at } = jackknifed();
    const turning = driveUntil(sim, ctl({ steer: -1, gear: 'R' }), (s) => s.steer === -1);
    const pushed = drive(sim, ctl({ steer: -1, lever: 1, gear: 'R' }), 600);
    for (const s of [...turning, ...pushed]) expect(s.truck).toEqual(at.truck);
    expectHeld(pushed, at);
    expect(last(pushed).blocked).toBe(at.blocked);
    const end = last(drive(sim, ctl({ steer: -1, lever: 1 }), 60));
    expect(dist2(end.truck, at.truck)).toBeGreaterThan(0);
    expect(end.blocked).toBeNull();
    expect(end.jackknifes).toBe(1);
  });

  it('a contact rejects the step, stops and counts one event', () => {
    const wall: ContactQuery = (bodies) => {
      const trailer = bodies.find((b) => b.body === 'trailer');
      return trailer && trailer.obb.cx < -8 ? { body: 'trailer', obstacleId: 'wall' } : null;
    };
    const sim = createSimulation(manKrone(), origin, wall);
    const reverse = ctl({ lever: 1, gear: 'R' });
    const at = last(driveUntil(sim, reverse, (s) => s.blocked !== null));
    expect(at.blocked).toBe('contact');
    expect(at.contacts).toBe(1);
    expect(at.speed).toBe(0);
    for (const s of drive(sim, reverse, 60)) {
      expect(s.truck).toEqual(at.truck);
      expect(s.contacts).toBe(1);
    }
    const end = last(drive(sim, ctl({ lever: 1 }), 30));
    expect(end.truck.x).toBeGreaterThan(at.truck.x);
    expect(end.blocked).toBeNull();
    expect(end.contacts).toBe(1);
  });

  it('wedged between two obstacles counts each once', () => {
    let gate = Infinity;
    const wedge: ContactQuery = (bodies) => {
      const truck = bodies.find((b) => b.body === 'truck');
      const trailer = bodies.find((b) => b.body === 'trailer');
      if (trailer && trailer.obb.cx < -8) return { body: 'trailer', obstacleId: 'wall' };
      return truck && truck.obb.cx > gate ? { body: 'truck', obstacleId: 'gate' } : null;
    };
    const sim = createSimulation(manKrone(), origin, wedge);
    const at = last(driveUntil(sim, ctl({ lever: 1, gear: 'R' }), (s) => s.blocked !== null));
    expect(at.contacts).toBe(1);
    const [truck] = bodyFootprints(manKrone(), at);
    gate = truck?.obb.cx ?? -Infinity;
    const forward = drive(sim, ctl({ lever: 1 }), 60);
    for (const s of forward) expect(s.truck).toEqual(at.truck);
    expect(last(forward).blocked).toBe('contact');
    expect(last(forward).contacts).toBe(2);
    for (const gear of ['R', 'D', 'R', 'D', 'R', 'D'] as const) {
      for (const s of drive(sim, ctl({ lever: 1, gear }), 30)) {
        // the rejected full step leaves up to one step of real gap to the wall
        expect(dist2(s.truck, at.truck)).toBeLessThanOrEqual(V_MAX * DT);
        expect(s.contacts).toBe(2);
      }
    }
  });

  it('grazing a wall counts one contact while the vehicle edges along it', () => {
    const wall = createContactQuery([
      {
        id: 'wall',
        kind: 'wall',
        height: 2,
        obb: { cx: 50, cy: -3.5, halfLength: 70, halfWidth: 0.5, heading: 0 },
      },
    ]);
    const sim = createSimulation(manKrone(), { truck: { x: 0, y: 0, heading: deg(-6) } }, wall);
    const at = last(driveUntil(sim, ctl({ lever: 1 }), (s) => s.blocked !== null));
    expect(at.blocked).toBe('contact');
    const edging = drive(sim, ctl({ steer: 0.075, lever: 1 }), 600);
    expect(dist2(last(edging).truck, at.truck)).toBeGreaterThan(0);
    expect(last(edging).blocked).toBe('contact');
    for (const s of edging) expect(s.contacts).toBe(1);
  });

  it('touching the same obstacle again after driving clear counts again', () => {
    const wall: ContactQuery = (bodies) => {
      const trailer = bodies.find((b) => b.body === 'trailer');
      return trailer && trailer.obb.cx < -8 ? { body: 'trailer', obstacleId: 'wall' } : null;
    };
    const sim = createSimulation(manKrone(), origin, wall);
    const reverse = ctl({ lever: 1, gear: 'R' });
    expect(last(driveUntil(sim, reverse, (s) => s.blocked !== null)).contacts).toBe(1);
    driveDistance(sim, ctl({ lever: 1 }), EVENT_CLEAR_DISTANCE + 0.5);
    const again = last(driveUntil(sim, reverse, (s) => s.blocked !== null));
    expect(again.blocked).toBe('contact');
    expect(again.contacts).toBe(2);
  });

  it('sweeping out of a pivot limit and straight back counts one jackknife', () => {
    const p = { ...manKrone(), couplingLimit: deg(10) };
    const sim = createSimulation(p, origin, noContacts);
    driveUntil(sim, ctl({ steer: 1, lever: 1, gear: 'R' }), (s) => s.blocked !== null);
    const out = driveUntil(sim, ctl({ steer: -1, lever: 1, gear: 'R' }), (s) => s.blocked === null);
    const from = last(out);
    const back = driveUntil(sim, ctl({ steer: 1, lever: 1, gear: 'R' }), (s) => s.blocked !== null);
    expect(last(back).blocked).toBe('coupling');
    expect(dist2(last(back).truck, from.truck)).toBeLessThan(EVENT_CLEAR_DISTANCE);
    for (const s of [...out, ...back]) expect(s.jackknifes).toBe(1);
  });

  const pathLength = (snaps: readonly SimSnapshot[]): number =>
    snaps.slice(1).reduce((sum, s, i) => {
      const prev = snaps[i];
      return prev ? sum + dist2(s.truck, prev.truck) : sum;
    }, 0);

  /** Contact when the truck box centre passes `gate.x`. */
  const gated = (gate: { x: number }): ContactQuery => {
    return (bodies) => {
      const truck = bodies.find((b) => b.body === 'truck');
      return truck && truck.obb.cx > gate.x ? { body: 'truck', obstacleId: 'gate' } : null;
    };
  };
  const truckCentreX = (s: SimSnapshot): number =>
    bodyFootprints(manKrone(), s)[0]?.obb.cx ?? Number.NaN;
  const driveToBlock = (sim: Simulation, control: ControlVector): SimSnapshot[] => {
    const from = sim.snapshot();
    return [from, ...driveUntil(sim, control, (s) => s.step > from.step && s.blocked !== null)];
  };

  it('every rejection restarts the clearing distance, counted or not', () => {
    const gate = { x: 0 };
    const sim = createSimulation(manKrone(), origin, gated(gate));
    gate.x = truckCentreX(sim.snapshot()) + 0.3;
    expect(last(driveToBlock(sim, ctl({ lever: 1 }))).contacts).toBe(1);
    let edged = 0;
    for (let i = 0; i < 4; i++) {
      gate.x += 0.3;
      const run = driveToBlock(sim, ctl({ lever: 1 }));
      expect(pathLength(run)).toBeLessThan(EVENT_CLEAR_DISTANCE);
      edged += pathLength(run);
      expect(last(run).blocked).toBe('contact');
      expect(last(run).contacts).toBe(1);
    }
    expect(edged).toBeGreaterThan(EVENT_CLEAR_DISTANCE);
  });

  it('a jackknife on the other side of the same pivot is a new event', () => {
    const p = { ...manKrone(), couplingLimit: deg(2) };
    const sim = createSimulation(p, origin, noContacts);
    const first = last(driveToBlock(sim, ctl({ steer: 1, lever: 1, gear: 'R' })));
    expect(first.blocked).toBe('coupling');
    expect(first.couplingAngle).toBeLessThan(0);
    expect(first.jackknifes).toBe(1);
    const run = driveToBlock(sim, ctl({ steer: 1, lever: 1 }));
    const second = last(run);
    expect(second.blocked).toBe('coupling');
    expect(second.couplingAngle).toBeGreaterThan(0);
    expect(pathLength(run)).toBeLessThan(EVENT_CLEAR_DISTANCE);
    expect(second.jackknifes).toBe(2);
  });

  it('reverse travel clears the incident too', () => {
    const gate = { x: 0 };
    const sim = createSimulation(manKrone(), origin, gated(gate));
    gate.x = truckCentreX(sim.snapshot()) + 0.3;
    expect(last(driveToBlock(sim, ctl({ lever: 1 }))).contacts).toBe(1);
    driveDistance(sim, ctl({ lever: 1, gear: 'R' }), EVENT_CLEAR_DISTANCE + 0.5);
    const again = last(driveToBlock(sim, ctl({ lever: 1 })));
    expect(again.blocked).toBe('contact');
    expect(again.contacts).toBe(2);
  });

  it('D to R while moving decelerates through zero and counts one direction change', () => {
    const sim = createSimulation(manKrone(), origin, noContacts);
    driveUntil(sim, ctl({ lever: 1 }), (s) => s.speed === V_MAX);
    let prev = sim.snapshot();
    const snaps = driveUntil(sim, ctl({ lever: 1, gear: 'R' }), (s) => s.speed === -V_MAX);
    expect(last(snaps).speed).toBe(-V_MAX);
    for (const s of snaps) {
      expect(s.speed).toBeLessThanOrEqual(prev.speed);
      expect(prev.speed - s.speed).toBeLessThanOrEqual(ACCEL * DT + DECEL * DT + 1e-12);
      prev = s;
    }
    expect(last(snaps).directionChanges).toBe(1);
  });

  it('steering is rate-limited and road-wheel angle follows the lock', () => {
    for (const truck of trucks) {
      const p = resolveCombination(truck, trailerById('krone-azw-18'));
      const sim = createSimulation(p, origin, noContacts);
      const steps = Math.ceil(1 / (p.steerRate * DT));
      const snaps = drive(sim, ctl({ steer: 1 }), steps);
      expect(snaps[0]?.steer).toBe(p.steerRate * DT);
      expect(snaps[steps - 2]?.steer).toBeLessThan(1);
      expect(last(snaps).steer).toBe(1);
      for (const s of snaps) expect(s.roadWheelAngle).toBe(s.steer * p.maxRoadWheelAngle);
    }
  });

  it('speed follows the latched lever and never exceeds the walking-pace cap', () => {
    const sim = createSimulation(manKrone(), origin, noContacts);
    const half = drive(sim, ctl({ lever: 0.5 }), 300);
    for (const s of half) expect(s.speed).toBeLessThanOrEqual(0.5 * V_MAX);
    expect(last(half).speed).toBe(0.5 * V_MAX);
    const over = drive(sim, ctl({ lever: 3 }), 300);
    for (const s of over) {
      expect(s.speed).toBeLessThanOrEqual(V_MAX);
      expect(s.control.lever).toBe(1);
    }
    expect(last(over).speed).toBe(V_MAX);
    let prev = last(over);
    for (const s of drive(sim, ctl({ lever: 1, brake: true }), 60)) {
      expect(prev.speed - s.speed).toBeCloseTo(Math.min(BRAKE_DECEL * DT, prev.speed), 12);
      expect(s.control.lever).toBe(1);
      prev = s;
    }
    expect(prev.speed).toBe(0);
    const reverse = drive(sim, ctl({ lever: 1, gear: 'R' }), 300);
    for (const s of reverse) expect(s.speed).toBeGreaterThanOrEqual(-V_MAX);
    expect(last(reverse).speed).toBe(-V_MAX);
  });

  it('clamps long frame gaps', () => {
    const clamped = advanceClock(0, 5);
    expect(clamped.steps).toBe(MAX_STEPS_PER_FRAME);
    expect(clamped.accumulator).toBeCloseTo(0, 9);
    expect(advanceClock(0, DT / 2).steps).toBe(0);
    expect(advanceClock(DT / 2, DT / 2).steps).toBe(1);
  });

  it('treats a negative or non-finite frame time as zero', () => {
    for (const frame of [-1, -DT, Number.NaN, Infinity, -Infinity]) {
      expect(advanceClock(DT / 2, frame)).toEqual({ steps: 0, accumulator: DT / 2 });
    }
  });

  describe('prediction', () => {
    const horizon = 10;

    /** Compares each predicted point with the driven path, matched by arc length. */
    const worstGap = (
      predicted: readonly Vec2[],
      start: Vec2,
      snaps: readonly Vec2[],
      dist: readonly number[],
    ): number => {
      expect(predicted).toHaveLength(horizon / PREDICT_STEP + 1);
      const points = [start, ...snaps];
      const arc = [0, ...dist];
      let worst = 0;
      predicted.forEach((point, k) => {
        const target = k * PREDICT_STEP;
        const j = Math.max(
          1,
          arc.findIndex((d) => d >= target),
        );
        const [a, b, da, db] = [points[j - 1], points[j], arc[j - 1], arc[j]];
        if (!a || !b || da === undefined || db === undefined) throw new Error('no bracket');
        const t = db === da ? 0 : (target - da) / (db - da);
        worst = Math.max(
          worst,
          dist2(point, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }),
        );
      });
      return worst;
    };

    /** Drives from a snapshot taken before the wheels settle and compares each point by arc length. */
    const compare = (
      p: VehicleParams,
      gear: 'D' | 'R',
      steer: number,
      pick: (s: SimSnapshot) => Vec2,
      line: (predicted: Prediction) => readonly Vec2[],
    ): number => {
      const sim = createSimulation(p, origin, noContacts);
      const from = sim.step(ctl({ steer, gear }));
      expect(from.steer).not.toBe(steer);
      const predicted = line(predictCombination(p, from, noContacts, horizon));
      settleSteer(sim, steer);
      const start = sim.snapshot();
      const { snaps, dist } = driveDistance(sim, ctl({ steer, lever: 1, gear }), horizon);
      return worstGap(predicted, pick(start), snaps.map(pick), dist);
    };

    it('trailer path from an unsettled standstill equals the path driven once the wheels settle', () => {
      for (const gear of ['D', 'R'] as const) {
        const worst = compare(
          open(manKrone()),
          gear,
          0.4,
          (s) => s.trailerRear,
          (r) => r.trailer,
        );
        expect(worst).toBeLessThan(0.02);
      }
    });

    it('trailer path from a moving start follows the wheels still ramping to the target', () => {
      for (const gear of ['D', 'R'] as const) {
        const p = open(manKrone());
        const sim = createSimulation(p, origin, noContacts);
        const cruise = ctl({ lever: 1, gear });
        driveUntil(sim, cruise, (s) => Math.abs(s.speed) === V_MAX);
        const turn = ctl({ steer: 0.6, lever: 1, gear });
        const from = last(drive(sim, turn, 10));
        expect(Math.abs(from.speed)).toBe(V_MAX);
        expect(from.steer).toBeGreaterThan(0);
        expect(from.steer).toBeLessThan(1);
        const predicted = predictCombination(p, from, noContacts, horizon).trailer;
        const { snaps, dist } = driveDistance(sim, turn, horizon);
        const worst = worstGap(
          predicted,
          from.trailerRear,
          snaps.map((s) => s.trailerRear),
          dist,
        );
        expect(worst).toBeLessThan(0.02);
      }
    });

    it('truck lines are the outer front corner and the inner rear-axle side, swapping with the steer sign', () => {
      const p = open(manKrone());
      const front = (s: SimSnapshot, side: 1 | -1): Vec2 => {
        const obb = bodyFootprints(p, s)[0]?.obb;
        if (obb === undefined) throw new Error('no truck footprint');
        return {
          x:
            obb.cx +
            obb.halfLength * Math.cos(obb.heading) -
            side * obb.halfWidth * Math.sin(obb.heading),
          y:
            obb.cy +
            obb.halfLength * Math.sin(obb.heading) +
            side * obb.halfWidth * Math.cos(obb.heading),
        };
      };
      const rear = (s: SimSnapshot, side: 1 | -1): Vec2 => ({
        x: s.truck.x - (side * p.truckWidth * Math.sin(s.truck.heading)) / 2,
        y: s.truck.y + (side * p.truckWidth * Math.cos(s.truck.heading)) / 2,
      });
      for (const gear of ['D', 'R'] as const) {
        // left (positive) steer turns toward the left: the left side is inner, the right front corner outer
        for (const [steer, inner, outer] of [
          [0.5, 1, -1],
          [-0.5, -1, 1],
        ] as const) {
          expect(
            compare(
              p,
              gear,
              steer,
              (s) => front(s, outer),
              (r) => r.truckOuter,
            ),
          ).toBeLessThan(0.02);
          expect(
            compare(
              p,
              gear,
              steer,
              (s) => rear(s, inner),
              (r) => r.truckInner,
            ),
          ).toBeLessThan(0.02);
        }
      }
    });

    it('reversing with held steer ends where the combination blocks', () => {
      const p = manKrone();
      for (const steer of [0.1, 0.4, 1]) {
        const sim = createSimulation(p, origin, noContacts);
        settleSteer(sim, steer);
        const reverse = ctl({ steer, lever: 1, gear: 'R' });
        const predicted = predictCombination(p, sim.step({ ...reverse, lever: 0 }), noContacts);
        const at = last(driveUntil(sim, reverse, (s) => s.blocked !== null));
        expect(predicted.blocked).toBe(at.blocked);
        expect(dist2(last(predicted.trailer), at.trailerRear)).toBeLessThan(0.1);
        expect(predicted.end).not.toBeNull();
        expect(predicted.end?.truck).toBeCloseTo(at.truck.heading, 1);
        expect(predicted.end?.trailer).toBeCloseTo(at.trailer.heading, 1);
        expect(predicted.truckOuter).toHaveLength(predicted.trailer.length);
      }
    });

    it('stops at a contact like the simulation, whichever body touches', () => {
      const p = manKrone();
      const cases = [
        { gear: 'R', reached: (x: number) => x < -8 },
        { gear: 'D', reached: (x: number) => x > 8 },
      ] as const;
      for (const { gear, reached } of cases) {
        const wall: ContactQuery = (bodies) => {
          const hit = bodies.find((b) => reached(b.obb.cx));
          return hit ? { body: hit.body, obstacleId: 'wall' } : null;
        };
        const sim = createSimulation(p, origin, wall);
        const drive = ctl({ lever: 1, gear });
        const predicted = predictCombination(p, sim.step({ ...drive, lever: 0 }), wall);
        const at = last(driveUntil(sim, drive, (s) => s.blocked !== null));
        expect(predicted.blocked).toBe('contact');
        expect(dist2(last(predicted.trailer), at.trailerRear)).toBeLessThan(0.1);
      }
    });

    it('stops the truck lines once its heading has swept a half turn, the trailer line goes on', () => {
      const p = open(manKrone());
      const sim = createSimulation(p, origin, noContacts);
      settleSteer(sim, 1);
      const circle = predictCombination(p, sim.snapshot(), noContacts);
      expect(circle.trailer).toHaveLength(PREDICT_DISTANCE / PREDICT_STEP + 1);
      expect(circle.truckOuter.length).toBeLessThan(circle.trailer.length);
      expect(circle.truckInner).toHaveLength(circle.truckOuter.length);
      expect(circle.end).toBeNull();

      const wall: ContactQuery = (bodies) =>
        bodies.some((b) => b.body === 'trailer' && b.obb.cy > 8)
          ? { body: 'trailer', obstacleId: 'wall' }
          : null;
      const blocked = predictCombination(p, sim.snapshot(), wall);
      expect(blocked.blocked).toBe('contact');
      expect(blocked.truckOuter.length).toBeLessThan(blocked.trailer.length);
      expect(blocked.end?.truck).toBeNull();
      expect(blocked.end?.trailer).toBeTypeOf('number');
    });

    it('a blocked standstill still yields the block and its end headings', () => {
      const p = manKrone();
      const sim = createSimulation(p, origin, noContacts);
      settleSteer(sim, 1);
      const reverse = ctl({ steer: 1, lever: 1, gear: 'R' });
      const at = last(driveUntil(sim, reverse, (s) => s.blocked !== null));
      const predicted = predictCombination(p, at, noContacts);
      expect(predicted.blocked).toBe(at.blocked);
      // the sim stops short of the block by less than MIN_PARTIAL, so no partial piece is added
      expect(predicted.trailer).toHaveLength(1);
      expect(predicted.truckOuter).toHaveLength(1);
      expect(predicted.end).toEqual({ truck: at.truck.heading, trailer: at.trailer.heading });
    });

    it('predicts nothing outside D and R', () => {
      const p = manKrone();
      const sim = createSimulation(p, origin, noContacts);
      for (const gear of ['P', 'N'] as const) {
        expect(predictCombination(p, sim.step(ctl({ gear })), noContacts)).toEqual(NO_PREDICTION);
      }
    });
  });
});
