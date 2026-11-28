import { describe, expect, it } from 'vitest';
import type { SignId } from '../contracts/einweiser';
import type { Pose2, SimSnapshot, Vec2 } from '../contracts/sim';
import { hasTrailer } from '../contracts/vehicle';
import { wrapAngle } from '../sim/angle';
import { BRAKE_DECEL, DECEL, DT, V_MAX } from '../sim/constants';
import { createSimulation } from '../sim/simulation';
import { mirrorMounts } from '../vehicles/mirrors';
import { trailers, trucks } from '../vehicles/registry';
import { CREEP_LEVER, createDriver, type DriverStep } from './driver';
import { sightGeometry } from './sight';
import { stoppingDistance } from './signs';
import { keysToward } from './gate-harness';
import { startWalker, walkStep, type Walker } from './walk';

const rigs = trucks.flatMap((truck) =>
  [...trailers, null].map((trailer) => ({
    truck,
    trailer,
    name: `${truck.id} ${trailer === null ? 'solo' : `with ${trailer.id}`}`,
  })),
);
const CREEP = CREEP_LEVER * V_MAX;
const STEP_CAP = 60 * 60;
/** Metres the truck travels into the curve before `turned` measures: the Krone rigs lose sight of him past about 5 m at the rear. */
const CURVE_RUN = { rear: 5, front: 4 };
/** The full Rechts curve (m of truck travel) a guide who walks with the rear end must hold sight through. */
const LONG_CURVE_RUN = 8;
/** How far (m) beyond his start, out to the left, he walks to: the Krone rigs lose sight of a guide who stays inboard of it (#601). */
const GUIDE_OUTBOARD = 4;
/** A guide on foot is within this (m) of the place he walks after. */
const GUIDE_TRACKING = 0.25;

type Script = (s: SimSnapshot, step: number) => { sign: SignId | null; pose: Pose2 };

/** Drives the rig from a straight start at the origin, heading +x, under the signs of `script`. */
function signal(
  truck: (typeof trucks)[number],
  trailer: (typeof trailers)[number] | null,
  script: Script,
  until: (s: SimSnapshot, d: DriverStep) => boolean,
): { s: SimSnapshot; trace: SimSnapshot[]; steps: DriverStep[] } {
  const g = sightGeometry(truck, trailer);
  const sim = createSimulation(g.params, { truck: { x: 0, y: 0, heading: 0 } }, () => null);
  const driver = createDriver(g, []);
  let s = sim.snapshot();
  const trace = [s];
  const steps: DriverStep[] = [];
  for (let step = 0; step < STEP_CAP; step++) {
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

describe.each(rigs)('signs for $name', ({ truck, trailer }) => {
  const g = sightGeometry(truck, trailer);
  const { params } = g;
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
      (now) => now.trailerRear.x < -(hasTrailer(params) ? params.trailerWheelbase : 0) - 8,
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

  // a few metres into the curve, against the straight line the leading end started on; a guide who stands still loses the Krone rigs past 5 m (#601), see the walking case below
  const turned = (
    sign: 'rechts' | 'links',
    place: (s: SimSnapshot) => Pose2,
    lead: 'rear' | 'front',
  ) => {
    const endOf = (now: SimSnapshot): Vec2 =>
      lead === 'rear' ? now.trailerRear : toWorld(now, { x: g.params.truckFront, y: 0 });
    const mark: { from: { x: number; end: Vec2; pose: Pose2 } | null } = { from: null };
    const { s, steps } = signal(
      truck,
      trailer,
      (now, step) => {
        if (mark.from === null && creeping(now) && step > 60) {
          mark.from = { x: now.truck.x, end: endOf(now), pose: place(now) };
        }
        return { sign: mark.from === null ? 'herkommen' : sign, pose: place(now) };
      },
      (now) => mark.from !== null && Math.abs(now.truck.x - mark.from.x) > CURVE_RUN[lead],
    );
    const kinds = steps.map((d) => d.reading.kind);
    expect(kinds).not.toContain('lost');
    expect(kinds).not.toContain('unclear');
    // the run ended on `until`, not on the step cap
    expect(steps.length).toBeLessThan(STEP_CAP);
    const { from } = mark;
    if (from === null) throw new Error('never crept');
    return { from, end: endOf(s), pose: place(s), jackknifes: s.jackknifes };
  };

  it('Rechts from behind moves the rear end to his right', () => {
    const { from, end, jackknifes } = turned('rechts', behind, 'rear');
    // his right as Rechts is first shown: he faces the cab along the truck, so it is the truck's right, -y
    const right = {
      x: Math.cos(from.pose.heading - Math.PI / 2),
      y: Math.sin(from.pose.heading - Math.PI / 2),
    };
    expect(right.y).toBeLessThan(-0.9);
    expect((end.x - from.end.x) * right.x + (end.y - from.end.y) * right.y).toBeGreaterThan(0.25);
    expect(jackknifes).toBe(0);
  });

  // solo only: from these stations the combination's driver loses sight of him before it straightens
  if (trailer === null) {
    it('Herkommen after Rechts from behind straightens the truck', () => {
      const mark = { curve: Number.NaN, straight: false, heading: 0, travelled: 0 };
      let last: Vec2 = { x: 0, y: 0 };
      const { s, steps } = signal(
        truck,
        trailer,
        (now, step) => {
          if (Number.isNaN(mark.curve) && creeping(now) && step > 60) mark.curve = now.truck.x;
          if (mark.straight) {
            mark.travelled += Math.hypot(now.trailerRear.x - last.x, now.trailerRear.y - last.y);
          } else if (Math.abs(now.truck.x - mark.curve) > 8) {
            mark.straight = true;
            mark.heading = now.trailer.heading;
          }
          last = now.trailerRear;
          const curving = !Number.isNaN(mark.curve) && !mark.straight;
          return { sign: curving ? 'rechts' : 'herkommen', pose: behind(now) };
        },
        () => mark.travelled > 20,
      );
      const kinds = steps.map((d) => d.reading.kind);
      expect(kinds).not.toContain('lost');
      expect(kinds).not.toContain('unclear');
      expect(mark.travelled).toBeGreaterThan(20);
      expect(s.speed).toBeCloseTo(-CREEP, 9);
      // the curve eases out over a few metres, then the heading holds
      expect(Math.abs(s.steer)).toBeLessThan(0.01);
      expect(Math.abs(wrapAngle(s.trailer.heading - mark.heading))).toBeLessThan(0.2);
    });
  }

  // a guide who stands still loses the Krone rigs here (#601); walking out and with the rear keeps sight
  if (trailer?.id === 'krone-azw-18') {
    it(`Rechts from behind holds sight through ${LONG_CURVE_RUN} m with a guide who walks out and keeps pace`, () => {
      const yard = { minX: -500, minY: -500, maxX: 500, maxY: 500 };
      const first = createSimulation(g.params, { truck: { x: 0, y: 0, heading: 0 } }, () => null);
      let walker: Walker = startWalker(g.params, first.snapshot());
      const start = walker;
      let station: Vec2 = start;
      const mark: { x: number | null; end: Vec2 | null } = { x: null, end: null };
      const { s, steps } = signal(
        truck,
        trailer,
        (now, step) => {
          if (mark.x === null && creeping(now) && step > 60) {
            mark.x = now.truck.x;
            mark.end = now.trailerRear;
          }
          const place = startWalker(g.params, now);
          const h = now.trailer.heading;
          station = {
            x: place.x - GUIDE_OUTBOARD * Math.sin(h),
            y: place.y + GUIDE_OUTBOARD * Math.cos(h),
          };
          const facingMirror = facing(walker, toWorld(now, mount));
          const facingWalker = { ...walker, heading: facingMirror };
          walker = walkStep(facingWalker, keysToward(facingWalker, station, true), DT, [], yard);
          return { sign: mark.x === null ? 'herkommen' : 'rechts', pose: walker };
        },
        (now) => mark.x !== null && Math.abs(now.truck.x - mark.x) > LONG_CURVE_RUN,
      );
      const kinds = steps.map((d) => d.reading.kind);
      expect(kinds).not.toContain('lost');
      expect(kinds).not.toContain('unclear');
      expect(steps.length).toBeLessThan(STEP_CAP);
      if (mark.end === null) throw new Error('never crept');
      // he walked out from his start to the place beside the rear and stayed with it
      expect(Math.hypot(walker.x - start.x, walker.y - start.y)).toBeGreaterThan(GUIDE_OUTBOARD);
      expect(Math.hypot(walker.x - station.x, walker.y - station.y)).toBeLessThan(GUIDE_TRACKING);
      // Rechts moved the rear end to his right, -y as he faces the cab along the truck
      expect(s.trailerRear.y - mark.end.y).toBeLessThan(-0.25);
      expect(s.jackknifes).toBe(0);
    });
  }

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
    const mark: { at: number | null } = { at: null };
    let since = 0;
    const { trace } = signal(
      truck,
      trailer,
      (now, step) => {
        since = creeping(now) ? since + 1 : 0;
        if (mark.at === null && since > 60) mark.at = step;
        return mark.at === null ? { sign: 'herkommen', pose: behind(now) } : cue(now);
      },
      (now) => mark.at !== null && now.speed === 0,
    );
    const at = mark.at;
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
