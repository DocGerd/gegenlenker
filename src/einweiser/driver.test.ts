import { describe, expect, it } from 'vitest';
import type { SignId } from '../contracts/einweiser';
import type { Pose2, SimSnapshot, Vec2 } from '../contracts/sim';
import { BRAKE_DECEL, DECEL, DT, V_MAX } from '../sim/constants';
import { createSimulation } from '../sim/simulation';
import { mirrorMounts } from '../vehicles/mirrors';
import { trailers, trucks } from '../vehicles/registry';
import { CREEP_LEVER, createDriver, type DriverStep } from './driver';
import { sightGeometry } from './sight';
import { stoppingDistance } from './signs';
import { startWalker } from './walk';

const pairs = trucks.flatMap((truck) => trailers.map((trailer) => ({ truck, trailer })));
const CREEP = CREEP_LEVER * V_MAX;

type Script = (s: SimSnapshot, step: number) => { sign: SignId | null; pose: Pose2 };

/** Drives the combination from a straight start at the origin, heading +x, under the signs of `script`. */
function signal(
  truck: (typeof trucks)[number],
  trailer: (typeof trailers)[number],
  script: Script,
  until: (s: SimSnapshot, d: DriverStep) => boolean,
): { s: SimSnapshot; trace: SimSnapshot[]; steps: DriverStep[] } {
  const g = sightGeometry(truck, trailer);
  const sim = createSimulation(g.params, { truck: { x: 0, y: 0, heading: 0 } }, () => null);
  const driver = createDriver(g, []);
  let s = sim.snapshot();
  const trace = [s];
  const steps: DriverStep[] = [];
  for (let step = 0; step < 60 * 60; step++) {
    const { sign, pose } = script(s, step);
    const d = driver.step(s, sign, pose);
    steps.push(d);
    s = sim.step(d.control);
    trace.push(s);
    if (until(s, d)) break;
  }
  return { s, trace, steps };
}

const facing = (from: Vec2, to: Vec2): number => Math.atan2(to.y - from.y, to.x - from.x);
const toWorld = (s: SimSnapshot, p: Vec2): Vec2 => {
  const [c, n] = [Math.cos(s.truck.heading), Math.sin(s.truck.heading)];
  return { x: s.truck.x + c * p.x - n * p.y, y: s.truck.y + n * p.x + c * p.y };
};

describe.each(pairs)('signs for $truck.id with $trailer.id', ({ truck, trailer }) => {
  const g = sightGeometry(truck, trailer);
  const mount = mirrorMounts(truck).mirrorLeft;
  /** Behind the trailer and out to its left, keeping his place ahead of the reversing rear, facing the left main mirror. */
  const behind = (s: SimSnapshot): Pose2 => {
    const start = startWalker(g.params, s);
    const at = { x: s.trailerRear.x - 3, y: start.y };
    return { ...at, heading: facing(at, toWorld(s, mount)) };
  };
  /** Ahead of the cab on its axis, facing the eye. */
  const ahead = (s: SimSnapshot): Pose2 => {
    const at = { x: s.truck.x + g.params.truckFront + 10, y: 0 };
    return { ...at, heading: facing(at, toWorld(s, g.eye)) };
  };
  const creeping = (s: SimSnapshot): boolean => Math.abs(Math.abs(s.speed) - CREEP) < 1e-9;

  it('Herkommen from behind reverses toward him', () => {
    const { s, steps } = signal(
      truck,
      trailer,
      (now) => ({ sign: 'herkommen', pose: behind(now) }),
      (now) => now.trailerRear.x < -g.params.trailerWheelbase - 8,
    );
    expect(steps.map((d) => d.reading.kind)).not.toContain('unclear');
    expect(s.control.gear).toBe('R');
    expect(s.speed).toBeCloseTo(-CREEP, 9);
  });

  it('Herkommen from ahead of the cab drives forward toward him', () => {
    const { s } = signal(
      truck,
      trailer,
      (now) => ({ sign: 'herkommen', pose: ahead(now) }),
      creeping,
    );
    expect(s.control.gear).toBe('D');
    expect(s.speed).toBeGreaterThan(0);
  });

  // a few metres into the curve, against the straight line the leading end started on
  const turned = (
    sign: 'rechts' | 'links',
    place: (s: SimSnapshot) => Pose2,
    lead: 'rear' | 'front',
  ) => {
    let from: { x: number; travelled: number } | null = null;
    const { s, steps } = signal(
      truck,
      trailer,
      (now, step) => {
        if (from === null && creeping(now) && step > 60) from = { x: now.truck.x, travelled: 0 };
        return { sign: from === null ? 'herkommen' : sign, pose: place(now) };
      },
      (now) => from !== null && Math.abs(now.truck.x - from.x) > (lead === 'rear' ? 8 : 4),
    );
    expect(steps.map((d) => d.reading.kind)).not.toContain('unclear');
    const end = lead === 'rear' ? s.trailerRear : toWorld(s, { x: g.params.truckFront, y: 0 });
    return { end, pose: place(s), jackknifes: s.jackknifes };
  };

  it('Rechts from behind moves the trailer rear to his right', () => {
    const { end, pose, jackknifes } = turned('rechts', behind, 'rear');
    const right = {
      x: Math.cos(pose.heading - Math.PI / 2),
      y: Math.sin(pose.heading - Math.PI / 2),
    };
    // he faces the cab along the truck, so his right is the truck's right: -y
    expect(right.y).toBeLessThan(-0.9);
    expect(end.x * right.x + end.y * right.y).toBeGreaterThan(0.3);
    expect(jackknifes).toBe(0);
  });

  it('Rechts from ahead of the cab mirrors: the truck turns to his right, the driver’s left', () => {
    const { end, pose } = turned('rechts', ahead, 'front');
    const right = {
      x: Math.cos(pose.heading - Math.PI / 2),
      y: Math.sin(pose.heading - Math.PI / 2),
    };
    expect(right.y).toBeGreaterThan(0.9);
    expect(end.y).toBeGreaterThan(0.3);
  });

  /** Distance the truck travels from the step `cue` first shows to standstill. */
  const stopping = (cue: (s: SimSnapshot) => { sign: SignId | null; pose: Pose2 }): number => {
    let at: number | null = null;
    let since = 0;
    const { trace } = signal(
      truck,
      trailer,
      (now, step) => {
        since = creeping(now) ? since + 1 : 0;
        if (at === null && since > 60) at = step;
        return at === null ? { sign: 'herkommen', pose: behind(now) } : cue(now);
      },
      (now) => at !== null && now.speed === 0,
    );
    if (at === null) throw new Error('never crept');
    let travelled = 0;
    for (let k = at; k + 1 < trace.length; k++) {
      const [a, b] = [trace[k], trace[k + 1]];
      if (a && b) travelled += Math.hypot(b.truck.x - a.truck.x, b.truck.y - a.truck.y);
    }
    return travelled;
  };

  it('stops from creep within the Halt stopping distance', () => {
    const d = stopping((now) => ({ sign: 'halt', pose: behind(now) }));
    expect(Math.abs(d - stoppingDistance(CREEP, DECEL))).toBeLessThan(2 * CREEP * DT);
  });

  it('brakes from creep within its stopping distance when it loses sight of him', () => {
    // straight behind the trailer: no mirror sees him
    const hidden = (now: SimSnapshot): Pose2 => ({
      x: now.trailerRear.x - 3,
      y: 0,
      heading: 0,
    });
    const d = stopping((now) => ({ sign: 'herkommen', pose: hidden(now) }));
    expect(Math.abs(d - stoppingDistance(CREEP, BRAKE_DECEL))).toBeLessThan(2 * CREEP * DT);
    expect(d).toBeLessThan(3);
  });
});
