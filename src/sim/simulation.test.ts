import { describe, expect, it } from 'vitest';
import type {
  ContactQuery,
  ControlVector,
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
import {
  ACCEL,
  BRAKE_DECEL,
  DECEL,
  DT,
  MAX_STEPS_PER_FRAME,
  PREDICT_STEP,
  V_MAX,
} from './constants';
import { predictTrailerRear } from './predict';
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

  it('steering out of a blocked pivot frees the same direction without a new event', () => {
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
    expect(advanceClock(0, 5)).toEqual({
      steps: MAX_STEPS_PER_FRAME,
      accumulator: expect.closeTo(0, 9),
    });
    expect(advanceClock(0, DT / 2).steps).toBe(0);
    expect(advanceClock(DT / 2, DT / 2).steps).toBe(1);
  });

  it('predicted trailer path matches the driven path', () => {
    for (const gear of ['D', 'R'] as const) {
      const p = open(manKrone());
      const sim = createSimulation(p, origin, noContacts);
      settleSteer(sim, 0.4);
      const from = sim.snapshot();
      const predicted = predictTrailerRear(p, from, gear === 'D' ? 1 : -1, 10);
      expect(predicted).toHaveLength(10 / PREDICT_STEP + 1);
      const { snaps, dist } = driveDistance(sim, ctl({ steer: 0.4, lever: 1, gear }), 10);
      const rears = [from.trailerRear, ...snaps.map((s) => s.trailerRear)];
      const arc = [0, ...dist];
      predicted.forEach((point, k) => {
        const target = k * PREDICT_STEP;
        const j = Math.max(
          1,
          arc.findIndex((d) => d >= target),
        );
        const [a, b, da, db] = [rears[j - 1], rears[j], arc[j - 1], arc[j]];
        if (!a || !b || da === undefined || db === undefined) throw new Error('no bracket');
        const t = db === da ? 0 : (target - da) / (db - da);
        const driven = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
        expect(dist2(point, driven)).toBeLessThan(0.02);
      });
    }
  });
});
