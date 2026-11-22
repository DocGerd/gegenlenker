import { describe, expect, it } from 'vitest';
import { EXERCISE_IDS } from '../contracts/exercise';
import type { ExerciseId } from '../contracts/exercise';
import { colliderId, LAYOUT_IDS } from '../contracts/layout';
import { KIT_FOOTPRINTS } from './kit';
import type { Obstacle } from '../contracts/layout';
import type { ControlVector, Pose2, Simulation, SimSnapshot, Vec2 } from '../contracts/sim';
import { createContactQuery, obbOverlap, SELF_OBSTACLE_ID } from '../sim/collision';
import { wrapAngle } from '../sim/angle';
import { bodyFootprints } from '../sim/geometry';
import { createSimulation } from '../sim/simulation';
import { targetError, WAYPOINT_RADIUS } from '../scoring/score';
import type { VehicleParams } from '../contracts/vehicle';
import { resolveCombination } from '../vehicles/resolve';
import { trailers, trucks } from '../vehicles/registry';
import { BARRIER_X, LANE } from './exercises/slalom';
import { exercises, layouts } from './registry';
import { resolveLayout } from './resolve-layout';
import { resolveRun } from './run';

const pairs = trucks.flatMap((truck) =>
  trailers.map((trailer) => [truck.id, trailer.id, truck, trailer] as const),
);

const cases = [
  ...Object.values(layouts).map((l) => ({
    name: l.id,
    resolved: resolveLayout(l, null),
    start: l.start,
    ids: { layoutId: l.id, exerciseId: null },
    exercise: null,
  })),
  ...exercises.map((e) => ({
    name: e.id,
    resolved: resolveLayout(layouts[e.layout], e),
    start: e.start,
    ids: { layoutId: e.layout, exerciseId: e.id },
    exercise: e,
  })),
];

const laneCentre = (LANE.minY + LANE.maxY) / 2;
const barrierSpacing = BARRIER_X[1] - BARRIER_X[0];

// Test-local steering waypoints for the forward drive out of each target: bay swings out of the
// bay column and west to the start; corner holds the outer lane through the bend; slalom swings
// to the open side of each barrier.
const via: Partial<Record<ExerciseId, Vec2[]>> = {
  'reverse-bay': [
    { x: 72, y: 32 },
    { x: 60, y: 30 },
  ],
  'reverse-corner': [
    { x: 16.5, y: 21 },
    { x: 28, y: 18.5 },
  ],
  slalom: Array.from({ length: 24 }, (_, i) => {
    const x = 20 + 3 * i;
    return { x, y: laneCentre + 3 * Math.cos((Math.PI * (x - BARRIER_X[0])) / barrierSpacing) };
  }),
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

describe.each(cases)('$name', ({ resolved, start, ids, exercise }) => {
  // dataFingerprint hashes the ordered OBBs without ids: sound only while contacts are counted by unique ids.
  it('has unique obstacle ids, none the self id', () => {
    const ids = resolved.obstacles.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(SELF_OBSTACLE_ID);
  });

  it.each(pairs)(
    '%s + %s starts clear and drives forward and backward',
    (truckId, trailerId, truck, trailer) => {
      const params = resolveCombination(truck, trailer);
      const query = createContactQuery(resolved.obstacles);
      const begin = resolveRun({ ...ids, truckId, trailerId }).start;
      for (const gear of ['D', 'R'] as const) {
        const sim = createSimulation(params, begin, query);
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
      (truckId, trailerId, truck, trailer) => {
        const params = resolveCombination(truck, trailer);
        const begin = resolveRun({ ...ids, truckId, trailerId }).start;
        const sim = createSimulation(params, begin, createContactQuery([]));
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
        (truckId, trailerId, truck, trailer) => {
          const params = resolveCombination(truck, trailer);
          const sim = createSimulation(
            params,
            resolveRun({ ...ids, truckId, trailerId }).start,
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

it('slalom cannot be driven in a straight line', () => {
  const slalom = exercises.find((e) => e.id === 'slalom');
  const { waypoint, start } = slalom ?? {};
  if (!slalom || !waypoint || !start) throw new Error('slalom needs a waypoint');
  const { obstacles } = resolveLayout(layouts[slalom.layout], slalom);
  const lane = [14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26];
  const length = waypoint.x - start.x;
  const free: string[] = [];
  for (const y0 of lane) {
    for (const y1 of lane) {
      const corridor = {
        cx: (start.x + waypoint.x) / 2,
        cy: (y0 + y1) / 2,
        halfLength: Math.hypot(length, y1 - y0) / 2,
        halfWidth: 0.5,
        heading: Math.atan2(y1 - y0, length),
      };
      if (!obstacles.some((o) => obbOverlap(corridor, o.obb))) free.push(`${y0}->${y1}`);
    }
  }
  expect(free).toEqual([]);
});

describe.each(Object.values(layouts))('$id props', (layout) => {
  it('have unique slash-free ids, colliders, and a fixture exactly on lamps', () => {
    const ids = layout.props.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const prop of layout.props) {
      expect(prop.id, prop.id).not.toContain('/');
      expect(prop.colliders.length, prop.id).toBeGreaterThan(0);
      expect(prop.fixture !== undefined, prop.id).toBe(prop.asset === 'lamp');
    }
  });

  it('collide as their kit piece stands: one box over its footprint, a gate or panel as a fence', () => {
    const kit = layout.props.filter((p) => p.asset === 'kit');
    expect(kit.length).toBeGreaterThan(0);
    for (const { id, colliders, kit: placed } of kit) {
      expect(placed, id).toBeDefined();
      if (placed === undefined) continue;
      const [only, ...rest] = colliders;
      expect(rest, id).toEqual([]);
      expect(only?.obb, id).toEqual(placed.footprint);
      const { cx, cy, halfLength, halfWidth, heading } = placed.footprint;
      const [c, s] = [Math.abs(Math.cos(heading)), Math.abs(Math.sin(heading))];
      const [rx, ry] = [c * halfLength + s * halfWidth, s * halfLength + c * halfWidth];
      expect(cx - rx, id).toBeGreaterThanOrEqual(layout.bounds.minX);
      expect(cx + rx, id).toBeLessThanOrEqual(layout.bounds.maxX);
      expect(cy - ry, id).toBeGreaterThanOrEqual(layout.bounds.minY);
      expect(cy + ry, id).toBeLessThanOrEqual(layout.bounds.maxY);
      expect(only?.height, id).toBe(KIT_FOOTPRINTS[placed.piece].height);
      expect(only?.kind, id).toBe(placed.piece.startsWith('fence-') ? 'fence' : 'furniture');
    }
  });

  it('keep the furniture clear of everything else and of every exercise target', () => {
    const furniture = layout.props.filter((p) => p.colliders.some((c) => c.kind === 'furniture'));
    expect(furniture.length).toBeGreaterThanOrEqual(6);
    for (const exercise of [null, ...exercises.filter((e) => e.layout === layout.id)]) {
      const { obstacles } = resolveLayout(layout, exercise);
      const target =
        exercise === null
          ? []
          : [
              {
                cx: exercise.target.pose.x,
                cy: exercise.target.pose.y,
                halfLength: exercise.target.length / 2,
                halfWidth: exercise.target.width / 2,
                heading: exercise.target.pose.heading,
              },
            ];
      for (const prop of furniture) {
        const own = new Set(prop.colliders.map((_, i) => colliderId(prop.id, i)));
        for (const { id, obb } of obstacles.filter((o) => own.has(o.id))) {
          for (const other of obstacles.filter((o) => !own.has(o.id))) {
            expect(obbOverlap(obb, other.obb), `${id} on ${other.id}`).toBe(false);
          }
          for (const zone of target) expect(obbOverlap(obb, zone), `${id} in target`).toBe(false);
        }
      }
    }
  });

  it('resolve after the street and loose obstacles, before the exercise ones', () => {
    for (const exercise of [null, ...exercises.filter((e) => e.layout === layout.id)]) {
      const resolved = resolveLayout(layout, exercise);
      const loose = layout.obstacles.map((o) => o.id);
      const colliders = layout.props.flatMap((p) => p.colliders.map((_, i) => colliderId(p.id, i)));
      const ids = resolved.obstacles.map((o) => o.id);
      const from = ids.indexOf(loose[0] ?? colliders[0] ?? '');
      expect(ids.slice(from, from + loose.length + colliders.length)).toEqual([
        ...loose,
        ...colliders,
      ]);
      expect(ids.slice(0, from).every((id) => id.startsWith('street-'))).toBe(true);
      expect(ids.slice(from + loose.length + colliders.length)).toEqual(
        (exercise?.obstacles ?? []).map((o) => o.id),
      );
    }
  });
});

/** Edge (m) of a flood-fill cell: fine against the margin of the narrowest passage (0.14 m). */
const FILL = 0.1;
/** Step (m) of the decor probe. */
const STEP = 0.25;
/** Half the narrowest vehicle: the clearance a vehicle's centre keeps from an obstacle. */
const HALF_WIDTH =
  Math.min(...trucks.map((t) => t.width.value), ...trailers.map((t) => t.width.value)) / 2000;

type Reach = { readonly reached: (x: number, y: number) => boolean; readonly count: number };

/**
 * Flood fill over the layout bounds on a grid of `FILL` cells, 4-connected, from `seeds`: the cells
 * a vehicle's centre can reach. An obstacle grown by `clearance` on every side blocks only the cells
 * that lie wholly inside it, so a passage a vehicle fits through is never closed by the grid.
 */
function floodReach(
  { bounds, obstacles }: ReturnType<typeof resolveLayout>,
  seeds: readonly Vec2[],
  clearance: number,
): Reach {
  const nx = Math.ceil((bounds.maxX - bounds.minX) / FILL);
  const ny = Math.ceil((bounds.maxY - bounds.minY) / FILL);
  const index = (x: number, y: number): [number, number] => [
    Math.floor((x - bounds.minX) / FILL),
    Math.floor((y - bounds.minY) / FILL),
  ];
  const at = (x: number, y: number): number => {
    const [ix, iy] = index(x, y);
    return ix < 0 || iy < 0 || ix >= nx || iy >= ny ? -1 : iy * nx + ix;
  };
  const blocked = new Uint8Array(nx * ny);
  for (const { obb } of obstacles) {
    const [c, s] = [Math.cos(obb.heading), Math.sin(obb.heading)];
    const [hl, hw] = [obb.halfLength + clearance, obb.halfWidth + clearance];
    const [rx, ry] = [Math.abs(c) * hl + Math.abs(s) * hw, Math.abs(s) * hl + Math.abs(c) * hw];
    const inside = (x: number, y: number): boolean => {
      const [dx, dy] = [x - obb.cx, y - obb.cy];
      return Math.abs(c * dx + s * dy) <= hl && Math.abs(-s * dx + c * dy) <= hw;
    };
    const [i0, j0] = index(obb.cx - rx, obb.cy - ry);
    const [i1, j1] = index(obb.cx + rx, obb.cy + ry);
    for (let j = Math.max(0, j0); j <= Math.min(ny - 1, j1); j++) {
      for (let i = Math.max(0, i0); i <= Math.min(nx - 1, i1); i++) {
        const [x0, y0] = [bounds.minX + i * FILL, bounds.minY + j * FILL];
        if (
          inside(x0, y0) &&
          inside(x0 + FILL, y0) &&
          inside(x0, y0 + FILL) &&
          inside(x0 + FILL, y0 + FILL)
        ) {
          blocked[j * nx + i] = 1;
        }
      }
    }
  }
  const seen = new Uint8Array(nx * ny);
  const queue: number[] = [];
  for (const { x, y } of seeds) {
    const cell = at(x, y);
    if (cell >= 0 && blocked[cell] === 0 && seen[cell] === 0) {
      seen[cell] = 1;
      queue.push(cell);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head] ?? 0;
    const [ix, iy] = [cell % nx, Math.floor(cell / nx)];
    for (const [jx, jy] of [
      [ix + 1, iy],
      [ix - 1, iy],
      [ix, iy + 1],
      [ix, iy - 1],
    ] as const) {
      const next = jx < 0 || jy < 0 || jx >= nx || jy >= ny ? -1 : jy * nx + jx;
      if (next >= 0 && blocked[next] === 0 && seen[next] === 0) {
        seen[next] = 1;
        queue.push(next);
      }
    }
  }
  return {
    reached: (x, y) => {
      const cell = at(x, y);
      return cell >= 0 && seen[cell] === 1;
    },
    count: queue.length,
  };
}

describe.each(Object.values(layouts))('$id decor', (layout) => {
  const resolved = resolveLayout(layout, null);
  const { surfaces, bounds } = resolved;
  const { street } = layout;
  const owned = exercises.filter((e) => e.layout === layout.id);
  const carriageway = { x: (street.fromX + street.toX) / 2, y: street.kerbY - street.width / 2 };
  const entrance = {
    x: (street.entrance.fromX + street.entrance.toX) / 2,
    y: street.kerbY + street.pavement / 2,
  };
  const reach = floodReach(resolved, [layout.start, entrance, carriageway], HALF_WIDTH);

  it('has unique ids', () => {
    const ids = layout.decor.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // The flood fill is only worth its verdict if it reaches what a vehicle must reach.
  it('reaches the start, the entrance, the street and every exercise start', () => {
    const wanted = [layout.start, entrance, carriageway, ...owned.map((e) => e.start)];
    for (const { x, y } of wanted) expect(reach.reached(x, y), `${x}, ${y}`).toBe(true);
    expect(reach.reached(50, layout.yard.maxY + 5), 'beyond the closed north edge').toBe(false);
    expect(reach.count).toBeGreaterThan(1000);
  });

  // The pavement strip beside the entrance is 2.35 m wide: a vehicle half a width past it is shut
  // out, and the fill must leak into the surroundings just short of that.
  it('is shut out of the pavement strip by 0.14 m and no more', () => {
    const strip = layout.street.pavement - 0.15;
    expect(2 * HALF_WIDTH).toBeGreaterThan(strip);
    expect(2 * HALF_WIDTH - strip).toBeLessThan(0.15);
    const seeds = [layout.start, entrance, carriageway];
    const stripMiddle = layout.street.kerbY + 0.15 + strip / 2;
    for (const x of [-5, 105]) {
      expect(reach.reached(x, stripMiddle), `${x} at the narrowest vehicle`).toBe(false);
      expect(floodReach(resolved, seeds, strip / 2 - 0.005).reached(x, stripMiddle), `${x}`).toBe(
        true,
      );
    }
  });

  // The fences along the plots are colliders: not even a vehicle that fits the strip gets behind them.
  it('keeps the side plots shut behind their fences', () => {
    const seeds = [layout.start, entrance, carriageway];
    const strip = layout.street.pavement - 0.15;
    const slim = floodReach(resolved, seeds, strip / 2 - 0.005);
    for (const x of [-5, 105]) expect(slim.reached(x, 30), `${x}`).toBe(false);
    const open = floodReach(
      { ...resolved, obstacles: resolved.obstacles.filter((o) => o.id.split('-')[0] !== 'kit') },
      seeds,
      strip / 2 - 0.005,
    );
    for (const x of [-5, 105]) expect(open.reached(x, 30), `${x} without the kit props`).toBe(true);
  });

  // A body reaches half its width past the cells its centre can reach, so the footprint is grown by that.
  it('stands beyond what a vehicle can reach', () => {
    for (const { id, footprint: f } of layout.decor) {
      const [c, s] = [Math.cos(f.heading), Math.sin(f.heading)];
      const [hl, hw] = [f.halfLength + HALF_WIDTH + FILL, f.halfWidth + HALF_WIDTH + FILL];
      const [rx, ry] = [Math.abs(c) * hl + Math.abs(s) * hw, Math.abs(s) * hl + Math.abs(c) * hw];
      for (let y = f.cy - ry; y <= f.cy + ry; y += STEP) {
        for (let x = f.cx - rx; x <= f.cx + rx; x += STEP) {
          const [dx, dy] = [x - f.cx, y - f.cy];
          if (Math.abs(c * dx + s * dy) <= hl && Math.abs(-s * dx + c * dy) <= hw) {
            expect(reach.reached(x, y), `${id} at ${x}, ${y}`).toBe(false);
          }
        }
      }
    }
  });

  it('stands off the yard and street surfaces and inside the layout bounds', () => {
    for (const { id, footprint: f } of layout.decor) {
      const reach = Math.hypot(f.halfLength, f.halfWidth);
      expect(f.cx - reach, id).toBeGreaterThan(bounds.minX);
      expect(f.cx + reach, id).toBeLessThan(bounds.maxX);
      expect(f.cy - reach, id).toBeGreaterThan(bounds.minY);
      expect(f.cy + reach, id).toBeLessThan(bounds.maxY);
      for (const { kind, rect } of surfaces) {
        const surface = {
          cx: (rect.minX + rect.maxX) / 2,
          cy: (rect.minY + rect.maxY) / 2,
          halfLength: (rect.maxX - rect.minX) / 2,
          halfWidth: (rect.maxY - rect.minY) / 2,
          heading: 0,
        };
        expect(obbOverlap(f, surface), `${id} on ${kind}`).toBe(false);
      }
    }
  });
});

it('registers exactly the contract ids', () => {
  expect(Object.keys(layouts).sort()).toEqual([...LAYOUT_IDS].sort());
  expect(exercises.map((e) => e.id)).toEqual([...EXERCISE_IDS]);
});

it('orders exercises as a curriculum, straight reverse first and slalom last', () => {
  expect(exercises.map((e) => e.id)).toEqual([
    'straight-reverse',
    'reverse-bay',
    'reverse-corner',
    'dock-ramp',
    'slalom',
  ]);
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
