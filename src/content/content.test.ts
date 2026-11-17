import { describe, expect, it } from 'vitest';
import { EXERCISE_IDS } from '../contracts/exercise';
import type { ExerciseId } from '../contracts/exercise';
import { LAYOUT_IDS } from '../contracts/layout';
import type { Obstacle } from '../contracts/layout';
import type { ControlVector, Pose2, Simulation, SimSnapshot, Vec2 } from '../contracts/sim';
import { createContactQuery, obbOverlap } from '../sim/collision';
import { wrapAngle } from '../sim/angle';
import { bodyFootprints } from '../sim/geometry';
import { createSimulation } from '../sim/simulation';
import { targetError, WAYPOINT_RADIUS } from '../scoring/score';
import type { VehicleParams } from '../contracts/vehicle';
import { resolveCombination } from '../vehicles/resolve';
import { trailers, trucks } from '../vehicles/registry';
import { exercises, layouts } from './registry';
import { resolveLayout } from './resolve-layout';

const pairs = trucks.flatMap((truck) =>
  trailers.map((trailer) => [truck.id, trailer.id, truck, trailer] as const),
);

const cases = [
  ...Object.values(layouts).map((l) => ({
    name: l.id,
    resolved: resolveLayout(l, null),
    start: l.start,
    exercise: null,
  })),
  ...exercises.map((e) => ({
    name: e.id,
    resolved: resolveLayout(layouts[e.layout], e),
    start: e.start,
    exercise: e,
  })),
];

// Test-local steering waypoints for the forward drive out of each target: bay swings out of the
// bay column and west to the start; corner holds the outer lane through the bend; slalom passes
// each barrier on its open side.
const via: Partial<Record<ExerciseId, Vec2[]>> = {
  'reverse-bay': [
    { x: 72, y: 32 },
    { x: 60, y: 30 },
  ],
  'reverse-corner': [
    { x: 16.5, y: 21 },
    { x: 28, y: 18.5 },
  ],
  slalom: [
    { x: 28, y: 22 },
    { x: 48, y: 18 },
    { x: 68, y: 22 },
    { x: 88, y: 18 },
  ],
};
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const MOVE = 0.5;
const CAP = 20_000;
const control = (c: Partial<ControlVector>): ControlVector => ({
  steer: 0,
  lever: 0.3,
  brake: false,
  gear: 'D',
  ...c,
});

function driveBy(sim: Simulation, gear: 'D' | 'R'): SimSnapshot {
  const from = sim.snapshot().truck;
  let s = sim.snapshot();
  for (let i = 0; i < CAP && dist(s.truck, from) < MOVE; i++) {
    s = sim.step(control({ gear }));
  }
  return s;
}

describe.each(cases)('$name', ({ resolved, start, exercise }) => {
  it('has unique obstacle ids', () => {
    const ids = resolved.obstacles.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(pairs)(
    '%s + %s starts clear and drives forward and backward',
    (_t, _tr, truck, trailer) => {
      const params = resolveCombination(truck, trailer);
      const query = createContactQuery(resolved.obstacles);
      for (const gear of ['D', 'R'] as const) {
        const sim = createSimulation(params, { truck: start }, query);
        expect(query(bodyFootprints(params, sim.snapshot()))).toBeNull();
        const end = driveBy(sim, gear);
        expect(dist(end.truck, start)).toBeGreaterThanOrEqual(MOVE);
        expect(end.contacts).toBe(0);
        expect(end.jackknifes).toBe(0);
      }
    },
  );

  if (exercise) {
    const { target } = exercise;
    const zone = {
      cx: target.pose.x + (target.length / 2) * Math.cos(target.pose.heading),
      cy: target.pose.y + (target.length / 2) * Math.sin(target.pose.heading),
      halfLength: target.length / 2,
      halfWidth: target.width / 2,
      heading: target.pose.heading,
    };

    it('target zone lies in the yard and overlaps no obstacle', () => {
      const { yard } = resolved;
      for (const [dl, dw] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ] as const) {
        const c = Math.cos(zone.heading);
        const s = Math.sin(zone.heading);
        const x = zone.cx + dl * zone.halfLength * c - dw * zone.halfWidth * s;
        const y = zone.cy + dl * zone.halfLength * s + dw * zone.halfWidth * c;
        expect(x).toBeGreaterThanOrEqual(yard.minX);
        expect(x).toBeLessThanOrEqual(yard.maxX);
        expect(y).toBeGreaterThanOrEqual(yard.minY);
        expect(y).toBeLessThanOrEqual(yard.maxY);
      }
      const hit = resolved.obstacles.filter((o) => obbOverlap(zone, o.obb)).map((o) => o.id);
      expect(hit).toEqual([]);
    });

    it.each(pairs)(
      '%s + %s does not start inside the target tolerance',
      (_t, _tr, truck, trailer) => {
        const params = resolveCombination(truck, trailer);
        const sim = createSimulation(params, { truck: start }, createContactQuery([]));
        const e = targetError(sim.snapshot(), target);
        expect({
          positionInside: e.position <= exercise.tolerances.position,
          angleInside: e.angle <= exercise.tolerances.angle,
          ...e,
        }).not.toMatchObject({ positionInside: true, angleInside: true });
      },
    );

    // The model is time-reversible, so a forward drive out of the target that ends near the reverse
    // run's origin shows a reverse run from there into the target exists. It starts from the
    // straight pose on the target, not from the exact start pose.
    it.each(pairs)(
      '%s + %s reaches the reverse-run origin by driving out of the target',
      (_t, _tr, truck, trailer) => {
        const params = resolveCombination(truck, trailer);
        const query = createContactQuery(resolved.obstacles);
        const h = target.pose.heading;
        const reach =
          params.trailerRearOverhang +
          params.trailerWheelbase +
          params.drawbar +
          params.couplingOffset;
        const sim = createSimulation(
          params,
          {
            truck: {
              x: target.pose.x + reach * Math.cos(h),
              y: target.pose.y + reach * Math.sin(h),
              heading: h,
            },
          },
          query,
        );
        expect(query(bodyFootprints(params, sim.snapshot()))).toBeNull();

        const goal = exercise.waypoint ?? start;
        const r = follow(sim, params, [...(via[exercise.id] ?? []), goal], 3, start.heading);
        expect(r).toEqual({ contacts: 0, jackknifes: 0, arrived: true });
      },
    );

    if (exercise.waypoint) {
      const { waypoint } = exercise;
      it.each(pairs)(
        '%s + %s drives forward from the start to the waypoint',
        (_t, _tr, truck, trailer) => {
          const params = resolveCombination(truck, trailer);
          const sim = createSimulation(
            params,
            { truck: start },
            createContactQuery(resolved.obstacles),
          );
          const route = [...(via[exercise.id] ?? []), waypoint];
          const r = follow(sim, params, route, WAYPOINT_RADIUS, null);
          expect(r).toEqual({ contacts: 0, jackknifes: 0, arrived: true });
        },
      );
    }
  }
});

/** Drives forward along `route`; arrival is within `radius` of its end, and of `heading` if given. */
function follow(
  sim: Simulation,
  params: VehicleParams,
  waypoints: readonly Vec2[],
  radius: number,
  heading: number | null,
): { contacts: number; jackknifes: number; arrived: boolean } {
  const route = [...waypoints];
  const goal = route[route.length - 1];
  if (!goal) throw new Error('empty route');
  let s = sim.snapshot();
  let arrived = false;
  for (let i = 0; i < CAP && !arrived; i++) {
    if (route.length > 1 && dist(s.truck, route[0] ?? goal) < 4) route.shift();
    s = sim.step(control({ lever: 1, steer: pursuit(s, route[0] ?? goal, params) }));
    arrived =
      dist(s.truck, goal) <= radius &&
      (heading === null || Math.abs(wrapAngle(s.truck.heading - heading)) <= Math.PI / 6);
  }
  return { contacts: s.contacts, jackknifes: s.jackknifes, arrived };
}

/** Pure pursuit of the truck rear axle toward `goal`, as a normalised steer value. */
function pursuit(
  s: SimSnapshot,
  goal: Vec2,
  params: { wheelbase: number; maxRoadWheelAngle: number },
): number {
  const dx = goal.x - s.truck.x;
  const dy = goal.y - s.truck.y;
  const alpha = wrapAngle(Math.atan2(dy, dx) - s.truck.heading);
  const delta = Math.atan((2 * params.wheelbase * Math.sin(alpha)) / Math.hypot(dx, dy));
  return delta / params.maxRoadWheelAngle;
}

it('registers exactly the contract ids', () => {
  expect(Object.keys(layouts).sort()).toEqual([...LAYOUT_IDS].sort());
  expect(exercises.map((e) => e.id)).toEqual([...EXERCISE_IDS]);
});

it('orders exercises by strictness, loosest first: position, then angle', () => {
  const tolerances = exercises.map((e) => e.tolerances);
  const sorted = [...tolerances].sort((a, b) => b.position - a.position || b.angle - a.angle);
  expect(tolerances).toEqual(sorted);
});

it('reversing into a real wall raises one contact and recovers forward', () => {
  const [truck] = trucks;
  const [trailer] = trailers;
  if (!truck || !trailer) throw new Error('no vehicles');
  const params = resolveCombination(truck, trailer);
  const reach =
    params.couplingOffset + params.drawbar + params.trailerWheelbase + params.trailerRearOverhang;
  const wall: Obstacle = {
    id: 'test-wall',
    kind: 'wall',
    obb: { cx: -(reach + 2), cy: 0, halfLength: 0.15, halfWidth: 10, heading: 0 },
    height: 2.5,
  };
  const origin: Pose2 = { x: 0, y: 0, heading: 0 };
  const sim = createSimulation(params, { truck: origin }, createContactQuery([wall]));

  let s = sim.snapshot();
  for (let i = 0; i < CAP && s.blocked === null; i++) s = sim.step(control({ gear: 'R' }));
  expect(s.blocked).toBe('contact');
  expect(s.contacts).toBe(1);

  sim.step(control({ gear: 'D' }));
  s = sim.step(control({ gear: 'D' }));
  expect(s.blocked).toBeNull();
  expect(s.contacts).toBe(1);
});
