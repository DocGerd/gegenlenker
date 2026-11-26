/**
 * Test-only: the Einweiser gate (`docs/einweiser-spike.md` §9, PR 2) that the per-exercise
 * `gate-*.test.ts` files share. A scripted, `walkStep`-only Einweiser guides the AI driver.
 */
import { HOLD_STEPS, type EinweiserFault, type SignId } from '../contracts/einweiser';
import type { ExerciseDefinition, ExerciseId, TargetZone } from '../contracts/exercise';
import type { Obstacle, Rect2 } from '../contracts/layout';
import type {
  ContactQuery,
  ControlVector,
  Pose2,
  SimSnapshot,
  StartState,
  Vec2,
} from '../contracts/sim';
import type { TrailerId, TruckId, VehicleParams } from '../contracts/vehicle';
import { BARRIER_X, LANE } from '../content/exercises/slalom';
import { exerciseById } from '../content/registry';
import { resolveRun } from '../content/run';
import { wrapAngle } from '../sim/angle';
import { ACCEL, BRAKE_DECEL, DECEL, DT, V_MAX } from '../sim/constants';
import { createContactQuery } from '../sim/collision';
import { bodyFootprints } from '../sim/geometry';
import { createSimulation } from '../sim/simulation';
import { trailerById, truckById, trailers, trucks } from '../vehicles/registry';
import {
  couplingAngle,
  joints,
  pivotViolation,
  rk4,
  turntableAngle,
  type KinematicState,
} from '../sim/kinematics';

import { createPilot, CURVE_RADIUS, type Pilot } from './driver';
import { createEinweiserRun } from './track';
import { rejoin, type Segment, straighten } from './gate-recovery';

import { clearance, runOver, signOutOfSight } from './faults';
import {
  bodyPoints,
  layoutOccluders,
  type Occluder,
  pointSight,
  sightGeometry,
  type SightGeometry,
  sightOf,
} from './sight';
import {
  inPath,
  judge,
  MOVEMENT_SIGNS,
  type Reading,
  recognitionTime,
  station,
  type Station,
  TOO_CLOSE,
} from './signs';
import { overlaps, STEP_HEIGHT, WALKER_RADIUS, type WalkKeys, type Walker } from './walk';

const DS = 0.05;

const approach = (current: number, target: number, maxDelta: number): number => {
  const next =
    Math.abs(target - current) <= maxDelta
      ? target
      : current + Math.sign(target - current) * maxDelta;
  return next === 0 ? 0 : next;
};
const isBraking = (c: ControlVector): boolean => c.brake || c.gear === 'P';
const targetSpeed = (c: ControlVector): number =>
  isBraking(c) ? 0 : (c.gear === 'D' ? 1 : c.gear === 'R' ? -1 : 0) * c.lever * V_MAX;
function nextSpeed(v: number, c: ControlVector): number {
  const vt = targetSpeed(c);
  const rate = isBraking(c)
    ? BRAKE_DECEL
    : Math.abs(vt) > Math.abs(v) && (v === 0 || Math.sign(v) === Math.sign(vt))
      ? ACCEL
      : DECEL;
  return approach(v, vt, rate * DT);
}

/** A contact-free copy of the sim step, from any snapshot. */
type Model = { s: SimSnapshot; q: KinematicState; pilot: Pilot; failed: boolean };

function modelFrom(s: SimSnapshot, pilot: Pilot): Model {
  return {
    s,
    q: {
      x: s.truck.x,
      y: s.truck.y,
      th0: s.truck.heading,
      th1: s.dolly.heading,
      th2: s.trailer.heading,
    },
    pilot: pilot.fork(),
    failed: false,
  };
}

function stepModel(p: VehicleParams, m: Model, reading: Reading, pose: Pose2): void {
  const c = m.pilot.step(m.s, reading, pose);
  const control = {
    steer: Math.max(-1, Math.min(1, c.steer)),
    lever: Math.max(0, Math.min(1, c.lever)),
    brake: c.brake,
    gear: c.gear,
  };
  const steer = approach(m.s.steer, control.steer, p.steerRate * DT);
  const speed = nextSpeed(m.s.speed, control);
  if (speed !== 0) {
    const next = rk4(p, m.q, speed, steer * p.maxRoadWheelAngle, DT);
    if (pivotViolation(p, next) !== null) m.failed = true;
    else m.q = next;
  }
  m.s = {
    ...m.s,
    step: m.s.step + 1,
    time: (m.s.step + 1) * DT,
    ...joints(p, m.q),
    couplingAngle: couplingAngle(m.q),
    turntableAngle: turntableAngle(m.q),
    steer,
    roadWheelAngle: steer * p.maxRoadWheelAngle,
    speed: m.failed ? 0 : speed,
    control,
  };
}

/** A plan of shown signs: each from its step offset on. */
type Plan = readonly { readonly at: number; readonly sign: SignId | null }[];

/**
 * Roll the model through `steps`, feeding the readings the reader would give for `plan` with him
 * always readable at `station`: `pending` is the shown sign's age when it is not yet acted on.
 */
function rollout(
  p: VehicleParams,
  m: Model,
  plan: Plan,
  steps: number,
  station: Station,
  pose: Pose2,
  pending: { sign: SignId | null; age: number } | null,
  each: (m: Model, k: number) => boolean | undefined,
): void {
  const due: { step: number; sign: SignId | null }[] = [];
  const shown = (sign: SignId | null, since: number): void => {
    due.length = 0;
    due.push({ step: since + Math.round(recognitionTime(sign) / DT) - 1, sign });
  };
  if (pending !== null) shown(pending.sign, -pending.age);
  let next = 0;
  for (let k = 0; k < steps && !m.failed; k++) {
    while (next < plan.length && (plan[next]?.at ?? Infinity) <= k) {
      const item = plan[next];
      if (item) shown(item.sign, item.at);
      next++;
    }
    let reading: Reading = { kind: 'none' };
    if (due[0]?.step === k) {
      reading = { kind: 'recognised', sign: due[0].sign, station };
      due.length = 0;
    }
    stepModel(p, m, reading, pose);
    if (each(m, k) === true) break;
  }
}

type Pt = { readonly x: number; readonly y: number; readonly h: number };

/** A path for the leading end at `DS` spacing; `h` is its direction of motion. */
function resample(points: readonly Vec2[]): Pt[] {
  const out: Pt[] = [];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    const h = Math.atan2(b.y - a.y, b.x - a.x);
    for (let t = carry; t < len; t += DS) {
      out.push({ x: a.x + (t / len) * (b.x - a.x), y: a.y + (t / len) * (b.y - a.y), h });
    }
    carry = (DS - ((len - carry) % DS)) % DS;
  }
  // smooth the headings over half a metre
  return out.map((p, i) => {
    const a = out[Math.max(0, i - 5)] ?? p;
    const b = out[Math.min(out.length - 1, i + 5)] ?? p;
    return { ...p, h: Math.atan2(b.y - a.y, b.x - a.x) };
  });
}

/** Straights (`k` 0) and arcs of curvature `k`, from a pose whose heading is the direction of motion. */
function arcs(from: Pose2, segs: readonly { len: number; k: number }[]): Pt[] {
  const points: Vec2[] = [from];
  let { x, y, heading: h } = from;
  for (const { len, k } of segs) {
    for (let t = 0; t < len - 1e-9; t += DS) {
      x += DS * Math.cos(h + (k * DS) / 2);
      y += DS * Math.sin(h + (k * DS) / 2);
      h += k * DS;
      points.push({ x, y });
    }
  }
  return resample(points);
}

function straight(from: Vec2, heading: number, length: number): Pt[] {
  return resample([
    from,
    { x: from.x + length * Math.cos(heading), y: from.y + length * Math.sin(heading) },
  ]);
}

function nearest(path: readonly Pt[], at: Vec2, from: number, window = 200): number {
  let best = from;
  let bd = Infinity;
  for (let i = Math.max(0, from - 40); i < Math.min(path.length, from + window); i++) {
    const p = path[i];
    if (!p) continue;
    const d = Math.hypot(p.x - at.x, p.y - at.y);
    if (d < bd) [best, bd] = [i, d];
  }
  return best;
}

/** The path's curvature about index `i` (left turn of the motion positive), over a metre either side. */
function curvatureAt(path: readonly Pt[], i: number): number {
  const [from, to] = [Math.max(0, i - 20), Math.min(path.length - 1, i + 20)];
  const [a, b] = [path[from], path[to]];
  return a && b && to > from ? wrapAngle(b.h - a.h) / ((to - from) * DS) : 0;
}

/** The trailer rear's own direction of motion in reverse: on a curve its overhang swings it off the body heading. */
function rearMotion(p: VehicleParams, s: SimSnapshot): number {
  return s.trailer.heading + Math.PI + Math.atan(p.trailerRearOverhang * trailerYaw(p, s));
}
/** The leading end's own direction of motion: forward, the truck's front swings off its heading by its reach ahead of the rear axle. */
function leadMotion(p: VehicleParams, s: SimSnapshot, gear: 'D' | 'R'): number {
  if (gear === 'R') return rearMotion(p, s);
  return s.truck.heading + Math.atan((p.truckFront * Math.tan(s.roadWheelAngle)) / p.wheelbase);
}
/** The trailer's heading change per metre reversed (left turn of the motion positive). */
const trailerYaw = (p: VehicleParams, s: SimSnapshot): number =>
  -Math.sin(s.turntableAngle) / p.trailerWheelbase;

/** Length scale (m) of the reverse tracking LQR: how far the rear takes to close on the path. */
const TRACK_LENGTH = 6;
/** Each sign is judged this long (s) after it would act. */
const TRACK_HORIZON = 2;
/** A turn sign replaces the shown one only when nearer the wanted curvature by this share of a turn's. */
const TRACK_HYSTERESIS = 0.3;
/** The shown sign keeps on unless another's cost is lower by this share. */
const TRACK_KEEP = 0.03;

/** A reverse whose best sign plan still hits something within this (s) is stopped and rescued. */
const DOOM_WITHIN = 4;
const MAX_RESCUES = 2;
/** A forward leg that is doomed this close (m) to its end stops there and counts as done. */
const CUT_SHORT = 8;
/** The rescue pulls forward until both joints are within this (rad), at least `RESCUE_MIN` and at most `RESCUE_MAX` metres. */
const RESCUE_STRAIGHT = 0.02;
const RESCUE_MIN = 4;
const RESCUE_MAX = 25;
/** Clearance (m) the pull-forward keeps from obstacles. */
const RESCUE_CLEARANCE = 0.3;
/** The fresh reverse joins the leg no later than this far (m) from its end on its final straight, on arcs of this radius (m). */
const RESCUE_FINAL = 16;
const RESCUE_RADIUS = 18;
/** Longer pull-forwards tried in this step (m). */
const RESCUE_STEP = 3;
/** The way back may rejoin the leg up to this far (m) before the latest join, tried in this step (m). */
const RESCUE_REJOIN = 30;
const RESCUE_REJOIN_STEP = 2;
/** The way back may turn no arc past this (rad). */
const RESCUE_TURN = (100 * Math.PI) / 180;

/** The curvature the reversing rear should run at to close on `path` at index `j`. */
function wantedCurvature(p: VehicleParams, s: SimSnapshot, path: readonly Pt[], j: number): number {
  const q = path[j];
  if (!q) return 0;
  const { e, he } = pathError(q, s.trailerRear, rearMotion(p, s));
  // the double integrator's LQR (e'' = curvature error, cost ∫ e² + L⁴·u² ds) is K = [1/L², √2/L]
  return curvatureAt(path, j) - e / TRACK_LENGTH ** 2 - (Math.SQRT2 * he) / TRACK_LENGTH;
}

/**
 * Cost-to-go of the path-relative LQR on [cross-track, heading, curvature error] per metre
 * (e' = heading error, heading error' = curvature error, curvature' = u), cost ∫ e² + L⁶·u² ds.
 */
function trackCostToGo(L: number): number[][] {
  const h = 0.05;
  // the transpose of A = [[1, h, 0], [0, 1, h], [0, 0, 1]]
  const At = [
    [1, 0, 0],
    [h, 1, 0],
    [0, h, 1],
  ];
  const r = L ** 6 * h;
  let P = [
    [h, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let n = 0; n < 20_000; n++) {
    const AP = At.map((row) =>
      [0, 1, 2].map((j) => row.reduce((sum, a, k) => sum + a * (P[k]?.[j] ?? 0), 0)),
    );
    const APA = AP.map((row) =>
      [0, 1, 2].map((j) => row.reduce((sum, a, k) => sum + a * (At[j]?.[k] ?? 0), 0)),
    );
    // B = [0, 0, h]: A'PB is column 2 of A'P times h, B'PB is P[2][2]·h²
    const APB = AP.map((row) => (row[2] ?? 0) * h);
    const BPB = (P[2]?.[2] ?? 0) * h * h;
    P = APA.map((row, i) =>
      row.map(
        (x, j) => (i === 0 && j === 0 ? h : 0) + x - ((APB[i] ?? 0) * (APB[j] ?? 0)) / (r + BPB),
      ),
    );
  }
  return P;
}
const TRACK_COST = trackCostToGo(TRACK_LENGTH);

/** `TRACK_COST` of the reversing rear's state about `path` at index `j`. */
function trackCost(p: VehicleParams, s: SimSnapshot, path: readonly Pt[], j: number): number {
  const q = path[j];
  if (!q) return 0;
  const { e, he } = pathError(q, s.trailerRear, rearMotion(p, s));
  const z = [e, he, trailerYaw(p, s) - curvatureAt(path, j)];
  return z.reduce(
    (sum, za, a) => sum + za * z.reduce((acc, zb, b) => acc + (TRACK_COST[a]?.[b] ?? 0) * zb, 0),
    0,
  );
}

/** Of `options` (a sign and the curvature it asks for), the one nearest `want`, keeping `current` within the hysteresis. */
function nearestSign(
  want: number,
  options: readonly { readonly sign: SignId; readonly kappa: number }[],
  current: SignId | null,
): SignId | null {
  let best: { sign: SignId; gap: number } | null = null;
  for (const o of options) {
    const keep = o.sign === current ? TRACK_HYSTERESIS / CURVE_RADIUS.R : 0;
    const gap = Math.abs(want - o.kappa) - keep;
    if (best === null || gap < best.gap) best = { sign: o.sign, gap };
  }
  return best?.sign ?? null;
}

const pathError = (p: Pt, at: Vec2, motion: number) => ({
  e: -(at.x - p.x) * Math.sin(p.h) + (at.y - p.y) * Math.cos(p.h),
  he: wrapAngle(motion - p.h),
});

const frontOf = (p: VehicleParams, s: SimSnapshot): Vec2 => ({
  x: s.truck.x + p.truckFront * Math.cos(s.truck.heading),
  y: s.truck.y + p.truckFront * Math.sin(s.truck.heading),
});

/** Pure pursuit of the truck rear axle along `route`, forward; the trace of every step. */
function pursue(
  p: VehicleParams,
  start: StartState,
  contacts: ContactQuery,
  waypoints: readonly Vec2[],
  done: (s: SimSnapshot) => boolean,
): SimSnapshot[] {
  const sim = createSimulation(p, start, contacts);
  const route = [...waypoints];
  const out = [sim.snapshot()];
  for (let i = 0; i < 40_000; i++) {
    const s = out[out.length - 1];
    if (!s || done(s)) break;
    const goal = route[0];
    if (!goal) break;
    if (route.length > 1 && Math.hypot(s.truck.x - goal.x, s.truck.y - goal.y) < 4) route.shift();
    const g = route[0] ?? goal;
    const [dx, dy] = [g.x - s.truck.x, g.y - s.truck.y];
    const alpha = wrapAngle(Math.atan2(dy, dx) - s.truck.heading);
    const delta = Math.atan((2 * p.wheelbase * Math.sin(alpha)) / Math.hypot(dx, dy));
    out.push(sim.step({ steer: delta / p.maxRoadWheelAngle, lever: 0.5, brake: false, gear: 'D' }));
  }
  return out;
}

type Leg = {
  readonly gear: 'D' | 'R';
  readonly path: readonly Pt[];
  /** Where he would stand, in order of preference, while the leading end is at path index `i`. */
  readonly anchors: (i: number, s: SimSnapshot) => Vec2[];
};

type View = {
  readonly s: SimSnapshot;
  readonly walker: Walker;
  readonly held: Pose2;
  readonly reading: Reading;
  readonly step: number;
};
type Act = { readonly keys: WalkKeys; readonly heading: number; readonly sign: SignId | null };

const NO_KEYS: WalkKeys = { forward: false, back: false, left: false, right: false, jog: false };

/** Keys that walk him toward `to`, in his facing frame. */
function keysToward(w: Walker, to: Vec2, jog: boolean): WalkKeys {
  const [dx, dy] = [to.x - w.x, to.y - w.y];
  const d = Math.hypot(dx, dy);
  const speed = Math.hypot(w.vx, w.vy);
  if (d < 0.08 || d < speed * 0.12) return NO_KEYS;
  const local = Math.atan2(dy, dx) - w.heading;
  const a = (Math.round(local / (Math.PI / 4)) * Math.PI) / 4;
  const [c, s] = [Math.round(Math.cos(a)), Math.round(Math.sin(a))];
  return { forward: c > 0, back: c < 0, left: s > 0, right: s < 0, jog: jog && d > 2 };
}

type World = {
  readonly g: SightGeometry;
  readonly occluders: readonly Occluder[];
  readonly pilot: Pilot;
  readonly yard: Rect2;
  readonly contacts: ContactQuery;
  readonly obstacles: readonly Obstacle[];
  /** Legs that set the vehicle up again on the target axis when the planned ones end outside it. */
  readonly recover: ((s: SimSnapshot) => Leg[]) | null;
  readonly policy: SignPolicy;
  /** How far (s) the search looks ahead on reverse legs. */
  readonly reverseHorizon: number;
};

const toWorld = (pose: Pose2, p: Vec2): Vec2 => {
  const [c, n] = [Math.cos(pose.heading), Math.sin(pose.heading)];
  return { x: pose.x + c * p.x - n * p.y, y: pose.y + n * p.x + c * p.y };
};

/** Grid A* from `from` to `to` around blocked points; the waypoints, or null when there is no way. */
function route(from: Vec2, to: Vec2, blocked: (p: Vec2) => boolean, yard: Rect2): Vec2[] | null {
  const cell = 0.5;
  const goal = { i: Math.round((to.x - from.x) / cell), j: Math.round((to.y - from.y) / cell) };
  const at = (i: number, j: number): Vec2 => ({ x: from.x + i * cell, y: from.y + j * cell });
  const name = (i: number, j: number): string => `${i},${j}`;
  type Node = { i: number; j: number; f: number; g: number; up: Node | null };
  const open: Node[] = [{ i: 0, j: 0, f: 0, g: 0, up: null }];
  const best = new Map<string, number>([[name(0, 0), 0]]);
  const h = (i: number, j: number): number => Math.hypot(i - goal.i, j - goal.j);
  for (let n = 0; n < 40_000 && open.length > 0; n++) {
    open.sort((a, b) => a.f - b.f);
    const cur = open.shift();
    if (!cur) break;
    if (cur.i === goal.i && cur.j === goal.j) {
      const out: Vec2[] = [to];
      for (let k = cur.up; k?.up; k = k.up) out.unshift(at(k.i, k.j));
      return out;
    }
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ] as const) {
      const [i, j] = [cur.i + di, cur.j + dj];
      const q = at(i, j);
      const inside =
        q.x > yard.minX + 0.4 &&
        q.x < yard.maxX - 0.4 &&
        q.y > yard.minY + 0.4 &&
        q.y < yard.maxY - 0.4;
      if (!inside) continue;
      if (!(i === goal.i && j === goal.j) && blocked(q)) continue;
      const gNext = cur.g + Math.hypot(di, dj);
      if (gNext >= (best.get(name(i, j)) ?? Infinity)) continue;
      best.set(name(i, j), gNext);
      open.push({ i, j, g: gNext, f: gNext + h(i, j), up: cur });
    }
  }
  return null;
}

function scripted(world: World, planned: readonly Leg[]) {
  const legs = [...planned];
  let recoveries = 0;
  const { g, occluders, pilot, yard, obstacles } = world;
  let contacts: ContactQuery = world.contacts;
  const p = g.params;
  const blocking = occluders.filter((o) => o.height >= STEP_HEIGHT);
  const grown = (s: Pick<SimSnapshot, 'truck' | 'coupling' | 'dolly' | 'trailer'>, by: number) =>
    bodyFootprints(p, s).map((b) => ({
      ...b,
      obb: { ...b.obb, halfLength: b.obb.halfLength + by, halfWidth: b.obb.halfWidth + by },
    }));
  let leg = 0;
  let phase: 'place' | 'walk' | 'signal' | 'drive' | 'stopping' = 'place';
  let finishing = false;
  let achtung = false;
  let sign: SignId | null = null;
  let shownAt = 0;
  let pending = false;
  let recognised: SignId | null | undefined = undefined;
  let idx = 0;
  let spot: Vec2 | null = null;
  let way: Vec2[] = [];
  let note = '';
  let cycleFrom = 0;
  /** The last search found every sign plan running into something soon. */
  let doomed = false;
  let replan = false;
  let rescues = 0;

  const show = (next: SignId | null, step: number): void => {
    if (next === sign) return;
    sign = next;
    shownAt = step;
    // the driver already acts on the sign it last recognised: showing it again changes nothing
    pending = next !== null && next !== recognised;
  };
  const leadingEnd = (s: SimSnapshot, gear: 'D' | 'R'): Vec2 =>
    gear === 'D' ? frontOf(p, s) : s.trailerRear;
  const motionOf = (s: SimSnapshot, gear: 'D' | 'R'): number =>
    gear === 'D' ? s.truck.heading : s.trailer.heading + Math.PI;
  const local = (s: SimSnapshot, at: Vec2): Occluder[] => {
    const pad = 12;
    const lo = { x: Math.min(at.x, s.truck.x) - pad, y: Math.min(at.y, s.truck.y) - pad };
    const hi = { x: Math.max(at.x, s.truck.x) + pad, y: Math.max(at.y, s.truck.y) + pad };
    // by extent, as the driver's own filter does: a long box can reach in from a far centre
    return occluders.filter(({ obb }) => {
      const r = Math.hypot(obb.halfLength, obb.halfWidth);
      return obb.cx + r >= lo.x && obb.cx - r <= hi.x && obb.cy + r >= lo.y && obb.cy - r <= hi.y;
    });
  };
  /** Where he is seen from: the eye if directly, else the first mirror that frames him. */
  const seenFrom = (s: SimSnapshot, at: Vec2): Vec2 => {
    const sight = pointSight(g, s, { x: at.x, y: at.y, z: 1.45 }, local(s, at));
    const mount = g.mirrors.find((m) => sight.mirrors.includes(m.id))?.mount;
    return toWorld(s.truck, sight.direct || mount === undefined ? g.eye : mount);
  };
  const facing = (s: SimSnapshot, at: Vec2): number => {
    const from = seenFrom(s, at);
    return Math.atan2(from.y - at.y, from.x - at.x);
  };
  const straightSign = (gear: 'D' | 'R', at: Station): SignId | null => {
    if (at === 'abeam') return null;
    return gear === (at === 'ahead' ? 'D' : 'R') ? 'herkommen' : 'entfernen';
  };
  const seen = (s: SimSnapshot, at: Vec2): boolean => {
    const sight = sightOf(g, s, bodyPoints(at), local(s, at));
    return sight.direct || sight.mirrors.length > 0;
  };
  const walkable = (at: Vec2): boolean =>
    at.x > yard.minX + 0.5 &&
    at.x < yard.maxX - 0.5 &&
    at.y > yard.minY + 0.5 &&
    at.y < yard.maxY - 0.5 &&
    !blocking.some((o) => overlaps(o.obb, at, WALKER_RADIUS + 0.1));
  /** Every sign he may give from `c` on this leg is readable there (facing where he is seen). */
  const readableAll = (s: SimSnapshot, c: Vec2, gear: 'D' | 'R'): boolean => {
    const straightHere = straightSign(gear, station(g, s.truck, c));
    if (straightHere === null) return false;
    const pose = { ...c, heading: facing(s, c) };
    const occ = local(s, c);
    const signs: SignId[] = [straightHere, 'halt'];
    if (!achtung) signs.push('achtung');
    return signs.every((sg) => {
      const ok = judge(g, s, pose, sg, occ);
      return ok.readable && (!MOVEMENT_SIGNS.has(sg) || ok.facing);
    });
  };
  /** He can stand at `c` with the vehicle at `s`: walkable, clear of it and its path, seen and readable. */
  const valid = (s: SimSnapshot, c: Vec2, gear: 'D' | 'R'): boolean =>
    walkable(c) &&
    clearance(p, s, c) >= 1 &&
    !inPath(g, s, c) &&
    seen(s, c) &&
    readableAll(s, c, gear);
  const RING: Vec2[] = [{ x: 0, y: 0 }];
  for (let r = 0.5; r <= 4; r += 0.5) {
    const n = Math.round((2 * Math.PI * r) / 0.5);
    for (let k = 0; k < n; k++) {
      RING.push({ x: r * Math.cos((2 * Math.PI * k) / n), y: r * Math.sin((2 * Math.PI * k) / n) });
    }
  }
  const SAMPLE = 30;
  const HORIZON = 14 * 60;
  const progress = (l: Leg, s: SimSnapshot): number =>
    nearest(l.path, leadingEnd(s, l.gear), idx, 400);
  /**
   * The vehicle from `s` while he signals from `at`: `shown` (the sign up, `age` steps old) is read
   * when due, then a rough follower steers it along the path (turn signs read at once) until `halt`
   * steps, when Halt goes up; `each` sees every step and may end it.
   */
  function follow(
    s: SimSnapshot,
    l: Leg,
    at: Station,
    pose: Pose2,
    shown: SignId,
    age: number,
    halt: number,
    steps: number,
    each: (m: SimSnapshot, k: number) => boolean | undefined,
  ): void {
    const S0 = straightSign(l.gear, at) ?? shown;
    const m = modelFrom(s, pilot);
    let due = Math.max(0, Math.round(recognitionTime(shown) / DT) - 1 - age);
    let wanted: SignId = shown;
    let read: SignId | null = recognised ?? null;
    let j = idx;
    for (let k = 0; k < steps && !m.failed; k++) {
      let reading: Reading = { kind: 'none' };
      if (k === halt) {
        wanted = 'halt';
        due = k + Math.round(recognitionTime('halt') / DT) - 1;
      }
      if (k === due && wanted !== read) {
        reading = { kind: 'recognised', sign: wanted, station: at };
        read = wanted;
      } else if (k > due && k % 30 === 0 && wanted !== 'halt' && read !== null) {
        j = nearest(l.path, leadingEnd(m.s, l.gear), j);
        const q = l.path[Math.min(l.path.length - 1, j + Math.round(3 / DS))];
        const here = l.path[j];
        if (q && here) {
          const mu = motionOf(m.s, l.gear);
          const cos = Math.cos(pose.heading - mu);
          const left: SignId = cos > 0 ? 'links' : 'rechts';
          const right: SignId = cos > 0 ? 'rechts' : 'links';
          let next: SignId | null;
          if (world.policy === 'lqr' && l.gear === 'R') {
            const turn = 1 / CURVE_RADIUS.R;
            next = nearestSign(
              wantedCurvature(p, m.s, l.path, j),
              [
                { sign: S0, kappa: 0 },
                { sign: left, kappa: turn },
                { sign: right, kappa: -turn },
              ],
              read,
            );
          } else {
            const { e } = pathError(here, leadingEnd(m.s, l.gear), mu);
            const err = wrapAngle(mu - q.h) + 0.3 * e;
            const want = err > 0.04 ? -1 : err < -0.04 ? 1 : 0;
            next = want === 0 ? S0 : want > 0 ? left : right;
          }
          if (next !== read) reading = { kind: 'recognised', sign: next, station: at };
          read = next;
        }
      }
      stepModel(p, m, reading, pose);
      if (each(m.s, k) === true) break;
    }
  }
  /** The vehicle once he gives the straight sign from `at`, sampled every `SAMPLE` steps. */
  const ahead = (s: SimSnapshot, l: Leg, at: Station, pose: Pose2): SimSnapshot[] => {
    const S0 = straightSign(l.gear, at);
    if (S0 === null) return [];
    const out: SimSnapshot[] = [];
    follow(s, l, at, pose, S0, 0, Infinity, HORIZON, (m, k) => {
      if (k % SAMPLE === SAMPLE - 1) out.push(m);
      return progress(l, m) >= l.path.length - 1;
    });
    return out;
  };
  /** Spots whose last cycle gained next to nothing: tried again only on the next leg. */
  const spent = new Set<string>();
  const keyOf = (c: Vec2): string => `${Math.round(c.x * 2)},${Math.round(c.y * 2)}`;
  /** How far the leading end gets along the path (m) while `c` stays valid once he signals from it. */
  function reach(s: SimSnapshot, l: Leg, c: Vec2): { gain: number; whole: boolean } {
    const at = station(g, s.truck, c);
    const future = ahead(s, l, at, { ...c, heading: facing(s, c) });
    let last = 0;
    while (last < future.length && valid(future[last] ?? s, c, l.gear)) last++;
    // the stop after the last valid sample takes about three more
    const usable = future[last - 4];
    const gain = usable === undefined ? 0 : (progress(l, usable) - idx) * DS;
    return { gain, whole: last === future.length && future.length > 0 };
  }
  /** The spot near an anchor that lets the vehicle get farthest once he signals from it. */
  function place(s: SimSnapshot, l: Leg): Vec2 | null {
    let best: Vec2 | null = null;
    let bestGain = 0;
    const tried = new Set<string>();
    const consider = (c: Vec2): boolean => {
      const k = keyOf(c);
      if (tried.has(k) || spent.has(k)) return false;
      tried.add(k);
      if (!valid(s, c, l.gear)) return false;
      const { gain, whole } = reach(s, l, c);
      if (whole) {
        best = c;
        return true;
      }
      if (gain > bestGain) [best, bestGain] = [c, gain];
      return gain >= 8;
    };
    for (const a of l.anchors(idx, s)) {
      for (const o of RING) if (consider({ x: a.x + o.x, y: a.y + o.y })) return best;
    }
    if (bestGain < 3) {
      for (const a of l.anchors(idx, s)) {
        for (let r = 4.5; r <= 9; r += 0.75) {
          for (let k = 0; k < 24; k++) {
            const c = {
              x: a.x + r * Math.cos((Math.PI * k) / 12),
              y: a.y + r * Math.sin((Math.PI * k) / 12),
            };
            if (consider(c)) return best;
          }
        }
      }
    }
    return bestGain >= 1.5 ? best : null;
  }
  /** Whether his spot stays valid if he lets the vehicle go on now and calls Halt at the next check. */
  function holds(s: SimSnapshot, l: Leg, at: Station, held: Pose2, step: number): boolean {
    if (spot === null || sign === null) return false;
    const c = spot;
    let ok = true;
    follow(
      s,
      l,
      at,
      held,
      sign,
      pending ? step - shownAt : Infinity,
      2 * HOLD_STEPS,
      240,
      (m, k) => {
        if (k % 15 === 14 && !valid(m, c, l.gear)) ok = false;
        return !ok || (k > 3 * HOLD_STEPS && m.speed === 0);
      },
    );
    return ok;
  }
  const canShow = (s: SimSnapshot, held: Pose2, next: SignId): boolean => {
    const ok = judge(g, s, held, next, local(s, held));
    return ok.readable && (!MOVEMENT_SIGNS.has(next) || ok.facing);
  };

  /** The sign to show now: the best of the straight sign and the showable turns, by rollout cost along the path. */
  function choose(s: SimSnapshot, l: Leg, at: Station, held: Pose2, S0: SignId): SignId | null {
    const goal = l.path.length - 1;
    doomed = false;
    contacts = createContactQuery(
      obstacles.filter((o) => Math.hypot(o.obb.cx - s.truck.x, o.obb.cy - s.truck.y) < 30),
    );
    const mu = motionOf(s, l.gear);
    const cos = Math.cos(held.heading - mu);
    const left: SignId = cos > 0 ? 'links' : 'rechts';
    const right: SignId = cos > 0 ? 'rechts' : 'links';
    const showable = (x: SignId): boolean => {
      if (x === sign) return true;
      if (!canShow(s, held, x)) return false;
      const m = modelFrom(s, pilot);
      rollout(p, m, [], Math.round(recognitionTime(x) / DT), at, held, null, () => undefined);
      return canShow(m.s, { ...held, heading: facing(m.s, held) }, x);
    };
    // from standstill a turn sign takes Herkommen's gear from his side of the cab axis
    const turnGear = at === 'ahead' ? 'D' : at === 'behind' ? 'R' : null;
    const turnable = Math.abs(cos) > 0.35 && (s.speed !== 0 || turnGear === l.gear);
    const turns = (turnable ? [left, right] : []).filter(showable);
    if (!showable(S0)) return null;
    if (world.policy === 'lqr' && l.gear === 'R') {
      // the LQR's cost-to-go once each sign has acted, on the exact model, plus clearance to obstacles
      let best: SignId | null = null;
      let bestCost = Infinity;
      let bestHit = Infinity;
      for (const x of [S0, ...turns]) {
        const m = modelFrom(s, pilot);
        let cost = 0;
        let j = idx;
        let hit = Infinity;
        let last = 0;
        const steps = Math.round((recognitionTime(x) + TRACK_HORIZON) / DT);
        rollout(p, m, x === sign ? [] : [{ at: 0, sign: x }], steps, at, held, null, (mm, k) => {
          last = k;
          if (k % 15 !== 0) return undefined;
          j = nearest(l.path, leadingEnd(mm.s, l.gear), j);
          if (contacts(bodyFootprints(p, mm.s)) !== null) {
            cost += 1e5;
            hit = Math.min(hit, k);
          } else if (contacts(grown(mm.s, 0.25)) !== null) cost += 50;
          return j >= goal;
        });
        if (m.failed) {
          cost += 1e6;
          hit = Math.min(hit, last);
        }
        cost += trackCost(p, m.s, l.path, nearest(l.path, m.s.trailerRear, j));
        if (x === sign) cost *= 1 - TRACK_KEEP;
        if (cost < bestCost) [best, bestCost, bestHit] = [x, cost, hit];
      }
      doomed = bestCost >= 1e5 && bestHit <= DOOM_WITHIN / DT;
      return best;
    }
    const candidates: Plan[] = [[{ at: 0, sign: S0 }]];
    for (const x of turns) {
      for (const tau of [1.2, 2, 3, 5, Infinity]) {
        const plan: { at: number; sign: SignId | null }[] = [{ at: 0, sign: x }];
        if (tau !== Infinity) plan.push({ at: Math.round(tau / DT), sign: S0 });
        candidates.push(plan);
      }
    }
    let best: Plan | null = null;
    let bestCost = Infinity;
    let bestHit = Infinity;
    for (const plan of candidates) {
      const m = modelFrom(s, pilot);
      let cost = 0;
      let j = idx;
      let first = Infinity;
      let last = 0;
      const keep = plan[0]?.sign === sign;
      const horizon = Math.round((l.gear === 'R' ? world.reverseHorizon : SEARCH_HORIZON) / DT);
      rollout(p, m, keep ? plan.slice(1) : plan, horizon, at, held, null, (mm, k) => {
        last = k;
        if (k % 15 !== 0) return undefined;
        j = nearest(l.path, leadingEnd(mm.s, l.gear), j);
        const q = l.path[j];
        if (!q) return true;
        const motion =
          world.policy === 'leadSearch' ? leadMotion(p, mm.s, l.gear) : motionOf(mm.s, l.gear);
        const { e, he } = pathError(q, leadingEnd(mm.s, l.gear), motion);
        cost += e * e + (3 * he) ** 2;
        const hit = contacts(bodyFootprints(p, mm.s));
        if (hit !== null) {
          cost += 1e5;
          first = Math.min(first, k);
        } else if (contacts(grown(mm.s, 0.25)) !== null) cost += 50;
        if (j >= goal) cost += 20 * (e * e + (3 * he) ** 2);
        return j >= goal;
      });
      if (m.failed) {
        cost += 1e6;
        first = Math.min(first, last);
      }
      const bonus = keep ? 0.05 * cost + 0.05 : 0;
      if (cost - bonus < bestCost) {
        bestCost = cost;
        bestHit = first;
        best = plan;
      }
    }
    doomed = bestCost >= 1e5 && bestHit <= DOOM_WITHIN / DT;
    return best?.[0]?.sign ?? null;
  }

  /**
   * Pull straight forward along the truck heading until the combination is straight, then reverse
   * on a fresh loop-free arc–straight–arc path back onto `l`, as late as it reaches; null without
   * room for either.
   */
  function rescue(s: SimSnapshot, l: Leg): Leg[] | null {
    const inside = (q: Vec2, margin: number): boolean =>
      q.x > yard.minX + margin &&
      q.x < yard.maxX - margin &&
      q.y > yard.minY + margin &&
      q.y < yard.maxY - margin;
    const clear = (q: KinematicState): boolean => {
      const front = {
        x: q.x + p.truckFront * Math.cos(q.th0),
        y: q.y + p.truckFront * Math.sin(q.th0),
      };
      return inside(front, 2) && world.contacts(grown(joints(p, q), RESCUE_CLEARANCE)) === null;
    };
    const q0 = {
      x: s.truck.x,
      y: s.truck.y,
      th0: s.truck.heading,
      th1: s.dolly.heading,
      th2: s.trailer.heading,
    };
    const goal = l.path.length - 1;
    // the latest join is on the final straight, at most `RESCUE_FINAL` from the end
    let last = goal;
    while (
      last > 0 &&
      (goal - last) * DS < RESCUE_FINAL &&
      Math.abs(curvatureAt(l.path, last)) < 1e-3
    )
      last--;
    const joins: number[] = [];
    const earliest = Math.max(0, last - Math.round(RESCUE_REJOIN / DS));
    for (let j = last; j >= earliest; j -= Math.round(RESCUE_REJOIN_STEP / DS)) joins.push(j);
    const fits = (from: Pose2, segments: readonly Segment[]): boolean =>
      arcs(from, segments).every((q) => inside(q, 1));
    // straight first, then further up to the farthest clear distance; the shortest way back wins
    let best: {
      distance: number;
      from: Pose2;
      way: NonNullable<ReturnType<typeof rejoin>>;
    } | null = null;
    const first = straighten(p, q0, RESCUE_STRAIGHT, RESCUE_MAX, clear).distance;
    for (let d = Math.max(first, RESCUE_MIN); d <= RESCUE_MAX + 1e-9; d += RESCUE_STEP) {
      const { distance, state } = straighten(p, q0, -1, d, clear);
      if (distance < RESCUE_MIN) break;
      const rear = joints(p, state).trailerRear;
      const from = { x: rear.x, y: rear.y, heading: state.th2 + Math.PI };
      const way = rejoin(from, l.path, joins, DS, RESCUE_RADIUS, RESCUE_TURN, fits);
      if (
        way !== null &&
        (best === null || distance + way.length < best.distance + best.way.length)
      )
        best = { distance, from, way };
      if (distance < d - 1e-6) break;
    }
    if (best === null) return null;
    const { distance, from, way } = best;
    const forward = straight(frontOf(p, s), s.truck.heading, distance);
    const back = [...arcs(from, way.segments), ...l.path.slice(way.join)];
    const end = l.path[goal];
    return [
      {
        gear: 'D',
        path: forward,
        // ahead of the cab, or behind the trailer for Entfernen when the way ahead is short
        anchors: (k, now) => [...forwardAnchors(forward, k), ...behindAnchors(now)],
      },
      {
        gear: 'R',
        path: back,
        // where the planned leg would have him, then beside the new path
        anchors: (k, now) => {
          const q = back[k] ?? back[back.length - 1] ?? end ?? now.trailerRear;
          return [
            ...l.anchors(nearest(l.path, q, 0, l.path.length), now),
            ...reverseAnchors(back, k),
          ];
        },
      },
    ];
  }

  return {
    phase: () => `${phase}:${leg} ${note}`,
    step({ s, walker, held, reading, step }: View): Act {
      if (reading.kind === 'recognised') {
        if (reading.sign === sign) pending = false;
        recognised = reading.sign;
        if (reading.sign === 'achtung') achtung = true;
      }
      if (reading.kind === 'lost' || reading.kind === 'unclear' || reading.kind === 'inPath') {
        note = `${reading.kind}@${(step / 60).toFixed(1)}`;
        recognised = undefined;
        pending = false;
        sign = null;
        if (phase === 'drive' || phase === 'stopping') {
          phase = 'stopping';
          finishing = false;
        } else if (phase === 'signal') phase = 'place';
      }
      if (leg >= legs.length && world.recover !== null && recoveries < 2) {
        legs.push(...world.recover(s));
        recoveries += 1;
      }
      const l = legs[leg];
      if (!l) return { keys: NO_KEYS, heading: walker.heading, sign: 'halt' };
      const heading = facing(s, walker);
      idx = nearest(l.path, leadingEnd(s, l.gear), idx, phase === 'drive' ? 200 : l.path.length);
      const at = station(g, s.truck, held);
      const S0 = straightSign(l.gear, at);
      const goal = l.path.length - 1;
      const inSight = seen(s, held);

      if (phase === 'stopping') {
        if (sign === null && inSight && s.speed !== 0 && canShow(s, held, 'halt'))
          show('halt', step);
        const done = finishing ? recognised === 'halt' && !pending : !pending;
        if (s.speed === 0 && done) {
          const extra = replan ? rescue(s, l) : null;
          replan = false;
          if (extra !== null) {
            legs.splice(leg + 1, 0, ...extra);
            rescues += 1;
            finishing = true;
            note = `rescue@${(step / 60).toFixed(1)}`;
          }
          if (finishing) {
            leg += 1;
            idx = 0;
            spent.clear();
          }
          finishing = false;
          phase = 'place';
          spot = null;
          show(null, step);
        }
        return { keys: NO_KEYS, heading, sign };
      }

      if (phase === 'place') {
        if (sign !== null && !pending) show(null, step);
        if (step % HOLD_STEPS !== 0) return { keys: NO_KEYS, heading, sign };
        spot = place(s, l);
        if (spot === null) {
          note = `nospot@${(step / 60).toFixed(1)}`;
          return { keys: NO_KEYS, heading, sign };
        }
        const bodies = bodyFootprints(p, s);
        const target = spot;
        way = route(
          walker,
          target,
          (q) =>
            blocking.some((o) => overlaps(o.obb, q, WALKER_RADIUS + 0.15)) ||
            bodies.some((b) => overlaps(b.obb, q, WALKER_RADIUS + 0.3)),
          yard,
        ) ?? [target];
        phase = 'walk';
      }

      if (phase === 'walk') {
        if (sign !== null && !pending) show(null, step);
        const first = way[0] ?? spot ?? walker;
        if (way.length > 1 && Math.hypot(first.x - walker.x, first.y - walker.y) < 0.4) way.shift();
        const target = way[0] ?? first;
        const keys = keysToward(walker, target, true);
        const there =
          way.length <= 1 && Math.hypot(target.x - walker.x, target.y - walker.y) < 0.15;
        const still = Math.hypot(walker.vx, walker.vy) < 0.05;
        if (there && still) phase = 'signal';
        return { keys, heading, sign };
      }

      if (phase === 'signal') {
        if (S0 === null || !inSight || s.speed !== 0) return { keys: NO_KEYS, heading, sign };
        if (Math.hypot(held.x - walker.x, held.y - walker.y) > 0.05)
          return { keys: NO_KEYS, heading, sign };
        const next = achtung ? (choose(s, l, at, held, S0) ?? S0) : 'achtung';
        if (!canShow(s, held, next)) {
          phase = 'place';
          return { keys: NO_KEYS, heading, sign };
        }
        show(next, step);
        if (achtung) {
          phase = 'drive';
          cycleFrom = idx;
        }
        return { keys: NO_KEYS, heading, sign };
      }

      // drive: he stands at his spot
      const togo = (goal - idx) * DS;
      const stance = { sign, age: step - shownAt };
      if (togo < 4 && inSight && canShow(s, held, 'halt')) {
        const m = modelFrom(s, pilot);
        rollout(p, m, [{ at: 0, sign: 'halt' }], 400, at, held, pending ? stance : null, (mm, k) =>
          mm.s.speed === 0 && k > 30 ? true : undefined,
        );
        if (nearest(l.path, leadingEnd(m.s, l.gear), idx) >= goal) {
          show('halt', step);
          phase = 'stopping';
          finishing = true;
          return { keys: NO_KEYS, heading, sign };
        }
      }
      if (
        step % HOLD_STEPS === 0 &&
        inSight &&
        !holds(s, l, at, held, step) &&
        canShow(s, held, 'halt')
      ) {
        note = `abort@${(step / 60).toFixed(1)}`;
        if ((idx - cycleFrom) * DS < 0.5 && spot !== null) spent.add(keyOf(spot));
        show('halt', step);
        phase = 'stopping';
        return { keys: NO_KEYS, heading, sign };
      }
      if (S0 !== null && !pending && inSight && step % 15 === 0) {
        const next = choose(s, l, at, held, S0);
        // forward, a path whose end the combination cannot follow is cut short rather than hit
        if (doomed && l.gear === 'D' && togo < CUT_SHORT && canShow(s, held, 'halt')) {
          note = `short@${(step / 60).toFixed(1)}`;
          show('halt', step);
          phase = 'stopping';
          finishing = true;
          return { keys: NO_KEYS, heading, sign };
        }
        if (doomed && l.gear === 'R' && rescues < MAX_RESCUES && canShow(s, held, 'halt')) {
          note = `doomed@${(step / 60).toFixed(1)}`;
          replan = true;
          show('halt', step);
          phase = 'stopping';
          return { keys: NO_KEYS, heading, sign };
        }
        if (next !== null && next !== sign) show(next, step);
      }
      return { keys: NO_KEYS, heading, sign };
    },
  };
}

type Outcome = {
  reached: boolean;
  faults: Partial<Record<EinweiserFault | 'runOver', number>>;
  contacts: number;
  jackknifes: number;
  position: number;
  angle: number;
  time: number;
  phase: string;
};

type Setup = {
  readonly params: VehicleParams;
  readonly start: SimSnapshot;
  readonly contacts: ContactQuery;
  readonly startState: StartState;
};

/** What the gate needs from scoring, which einweiser must not import: the tests pass it in. */
export type GateScoring = {
  readonly createRunTracker: (exercise: ExerciseDefinition) => {
    update(s: SimSnapshot): boolean;
  };
  readonly targetError: (
    s: SimSnapshot,
    zone: TargetZone,
  ) => { readonly position: number; readonly angle: number };
  readonly STOPPED_SPEED: number;
};

/** One gate case: the scripted Einweiser guiding the AI driver through the exercise. */
export function runGate(
  exerciseId: ExerciseId,
  truckId: TruckId,
  trailerId: TrailerId,
  { createRunTracker, targetError, STOPPED_SPEED }: GateScoring,
): Outcome {
  const legsFor = LEGS[exerciseId];
  if (!legsFor) throw new Error(`no gate legs for ${exerciseId}`);
  const exercise = exerciseById(exerciseId);
  const run = resolveRun({
    layoutId: exercise.layout,
    exerciseId,
    truckId,
    trailerId,
    role: 'driver',
  });
  const g = sightGeometry(truckById(truckId), trailerById(trailerId));
  const occluders = layoutOccluders(run.layout);
  const sim = createSimulation(run.params, run.start, run.contacts);
  const tracker = createRunTracker(exercise);
  const pilot = createPilot(run.params);
  let s = sim.snapshot();
  const legs = legsFor({
    params: run.params,
    start: s,
    contacts: run.contacts,
    startState: run.start,
  });
  const policy = scripted(
    {
      g,
      occluders,
      pilot,
      yard: run.layout.yard,
      contacts: run.contacts,
      obstacles: run.layout.obstacles,
      recover: (now) => recovery(run.params, now, exercise.target.pose, RECOVER[exerciseId] ?? 0),
      policy: POLICY[exerciseId] ?? 'search',
      reverseHorizon: REVERSE_HORIZON[exerciseId] ?? SEARCH_HORIZON,
    },
    legs,
  );
  const einweiser = createEinweiserRun({ g, occluders, yard: run.layout.yard, start: s, pilot });
  let reading: Reading = { kind: 'none' };
  let lastSign: SignId | null = null;
  let acted: string | null = null;
  let achtung = false;
  const faults: Partial<Record<EinweiserFault | 'runOver', number>> = {};
  const active = new Set<string>();
  const flag = (kind: EinweiserFault | 'runOver', on: boolean): void => {
    if (on && !active.has(kind)) faults[kind] = (faults[kind] ?? 0) + 1;
    if (on) active.add(kind);
    else active.delete(kind);
  };
  let reached = false;
  let lastEvent = 0;
  for (let step = 0; step < 60 * 600 && !reached && step - lastEvent < 60 * 60; step++) {
    const act = policy.step({
      s,
      walker: einweiser.walker(),
      held: einweiser.held(),
      reading,
      step,
    });
    const d = einweiser.step(s, { keys: act.keys, heading: act.heading, pitch: 0, sign: act.sign });
    const held = d.status.held;
    reading = d.reading;
    const moving = Math.abs(s.speed) > STOPPED_SPEED;
    flag('runOver', moving && runOver(run.params, s, held, d.moved));
    flag('inPath', moving && inPath(g, s, held));
    flag('tooClose', moving && clearance(run.params, s, held) < TOO_CLOSE);
    flag('outOfSight', reading.kind === 'lost' && s.speed !== 0);
    flag('signOutOfSight', signOutOfSight(lastSign, act.sign, d.perception.inSight));
    flag('unclear', reading.kind === 'unclear');
    if (reading.kind === 'recognised') {
      if (reading.sign === 'achtung') achtung = true;
      flag('noAchtung', !achtung && reading.sign !== null && MOVEMENT_SIGNS.has(reading.sign));
    } else flag('noAchtung', false);
    if (reading.kind !== 'none') lastEvent = step;
    if (reading.kind !== 'none') {
      acted = reading.kind === 'recognised' ? String(reading.sign) : reading.kind;
    }
    lastSign = act.sign;
    s = sim.step(d.control);
    reached = tracker.update(s) && acted === 'halt';
    if (s.contacts > 0 || s.jackknifes > 0) break;
  }
  const err = targetError(s, exercise.target);
  return {
    reached,
    faults,
    contacts: s.contacts,
    jackknifes: s.jackknifes,
    position: Math.round(err.position * 100) / 100,
    angle: Math.round(err.angle * 100) / 100,
    time: Math.round(s.time),
    phase:
      policy.phase() +
      (s.contact
        ? ` hit ${s.contact.body}@${s.contact.point.x.toFixed(1)},${s.contact.point.y.toFixed(1)}`
        : ''),
  };
}

/** Beside the path: `ahead` of index `i` along it, `out` to its left. */
const beside = (path: readonly Pt[], i: number, ahead: number, out: number, past = true): Vec2 => {
  const last = path.length - 1;
  const j = past ? i + Math.round(ahead / DS) : Math.min(last, i + Math.round(ahead / DS));
  const q = path[Math.min(last, j)] ?? path[last];
  if (!q) throw new Error('empty path');
  const beyond = Math.max(0, j - last) * DS;
  return {
    x: q.x + beyond * Math.cos(q.h) - out * Math.sin(q.h),
    y: q.y + beyond * Math.sin(q.h) + out * Math.cos(q.h),
  };
};

/** Ahead of the leading end on a forward path: in the windscreen, at several distances. */
const forwardAnchors = (path: readonly Pt[], i: number): Vec2[] => [
  beside(path, i, 12, 0),
  beside(path, i, 18, 0),
  beside(path, i, 24, 0),
  beside(path, i, 15, 4),
  beside(path, i, 15, -4),
  beside(path, i, 9, 0),
];
/** Behind the trailer rear, out to either side. */
const behindAnchors = (s: SimSnapshot): Vec2[] => {
  const [c, n] = [Math.cos(s.trailer.heading), Math.sin(s.trailer.heading)];
  return [3, 6].flatMap((back) =>
    [3.2, -3.2].map((out) => ({
      x: s.trailerRear.x - back * c - out * n,
      y: s.trailerRear.y - back * n + out * c,
    })),
  );
};
/** Ahead of the reversing rear, out to either side. */
const reverseAnchors = (path: readonly Pt[], i: number): Vec2[] => [
  beside(path, i, 10, 3.2, false),
  beside(path, i, 10, -3.2, false),
  beside(path, i, 7, 3.2, false),
  beside(path, i, 7, -3.2, false),
  beside(path, i, 14, 4, false),
  beside(path, i, 14, -4, false),
];

const laneCentre = (LANE.minY + LANE.maxY) / 2;
const barrierSpacing = BARRIER_X[1] - BARRIER_X[0];
const SLALOM_VIA = Array.from({ length: 24 }, (_, i) => {
  const x = 20 + 3 * i;
  return { x, y: laneCentre + 3 * Math.cos((Math.PI * (x - BARRIER_X[0])) / barrierSpacing) };
});

/**
 * How the Einweiser picks signs, per exercise (why each: PR #515): the rollout search scored on the
 * body heading, the search scored on the leading end's own direction of motion, or (reverse legs) the
 * tracking LQR.
 */
type SignPolicy = 'search' | 'leadSearch' | 'lqr';
const POLICY: Partial<Record<ExerciseId, SignPolicy>> = {
  'dock-ramp': 'lqr',
  'reverse-bay': 'leadSearch',
  slalom: 'leadSearch',
};
/** How far (s) the search looks ahead. */
const SEARCH_HORIZON = 12;
/** A longer look on the reverse legs, per exercise (PR #515). */
const REVERSE_HORIZON: Partial<Record<ExerciseId, number>> = { slalom: 15 };

/** Room to pull forward along the target axis (m) before reversing onto it again. */
const RECOVER: Partial<Record<ExerciseId, number>> = {
  'straight-reverse': 10,
  'reverse-bay': 10,
  'dock-ramp': 20,
  slalom: 6,
};

/** Pull forward along the target axis, then reverse straight onto the target. */
function recovery(params: VehicleParams, s: SimSnapshot, target: Pose2, room: number): Leg[] {
  if (room <= 0) return [];
  const u = { x: Math.cos(target.heading), y: Math.sin(target.heading) };
  const along = (q: Vec2): number => (q.x - target.x) * u.x + (q.y - target.y) * u.y;
  const on = (d: number): Vec2 => ({ x: target.x + d * u.x, y: target.y + d * u.y });
  const front = along(frontOf(params, s));
  const rear = along(s.trailerRear);
  const forward = straight(on(front), target.heading, room);
  const reverse = straight(on(rear + room), target.heading + Math.PI, rear + room);
  const reach =
    params.truckFront +
    params.couplingOffset +
    params.drawbar +
    params.trailerWheelbase +
    params.trailerRearOverhang;
  return [
    { gear: 'D', path: forward, anchors: (i) => forwardAnchors(forward, i) },
    {
      gear: 'R',
      path: reverse,
      anchors: (i) => [...reverseAnchors(reverse, i), on(rear + room - i * DS + reach + 8)],
    },
  ];
}

const LEGS: Partial<Record<ExerciseId, (setup: Setup) => Leg[]>> = {
  'reverse-corner': ({ params, start }) => {
    const target = exerciseById('reverse-corner').target.pose;
    const R = 15;
    const over = 8;
    const rear = start.trailerRear;
    const reverse = arcs({ x: rear.x, y: rear.y, heading: Math.PI }, [
      { len: rear.x - (target.x + R), k: 0 },
      { len: (R * Math.PI) / 2, k: -1 / R },
      { len: target.y + over - (rear.y + R), k: 0 },
    ]);
    const reach =
      params.truckFront +
      params.couplingOffset +
      params.drawbar +
      params.trailerWheelbase +
      params.trailerRearOverhang;
    const forward = straight({ x: target.x, y: target.y + over - reach }, -Math.PI / 2, over);
    return [
      {
        gear: 'R',
        path: reverse,
        anchors: (i) => [
          beside(reverse, i, 10, -3.2, false),
          beside(reverse, i, 10, 3.2, false),
          beside(reverse, i, 7, -3.2, false),
          beside(reverse, i, 7, 3.2, false),
        ],
      },
      {
        gear: 'D',
        path: forward,
        anchors: (i) => [
          beside(forward, i, 10, 0),
          beside(forward, i, 8, 3),
          beside(forward, i, 8, -3),
        ],
      },
    ];
  },
  'reverse-bay': ({ params, start }) => {
    const target = exerciseById('reverse-bay').target.pose;
    const R = 15;
    const lane = 40;
    const shift = lane - start.truck.y;
    const radius = 10;
    const alpha = Math.acos(1 - shift / (2 * radius));
    const front = frontOf(params, start);
    const forward = arcs({ ...front, heading: start.truck.heading }, [
      { len: radius * alpha, k: -1 / radius },
      { len: radius * alpha, k: 1 / radius },
      { len: 16, k: 0 },
    ]);
    const last = forward[forward.length - 1];
    if (!last) throw new Error('no forward leg');
    const reach =
      params.truckFront +
      params.couplingOffset +
      params.drawbar +
      params.trailerWheelbase +
      params.trailerRearOverhang;
    const rearX = last.x + reach;
    const reverse = arcs({ x: rearX, y: lane, heading: 0 }, [
      { len: target.x - R - rearX, k: 0 },
      { len: (R * Math.PI) / 2, k: -1 / R },
      { len: lane - R - target.y, k: 0 },
    ]);
    const cab = reach + 8;
    return [
      {
        gear: 'D',
        path: forward,
        anchors: (i) => forwardAnchors(forward, i),
      },
      {
        gear: 'R',
        path: reverse,
        anchors: (i, s) => {
          const mouth = s.trailerRear.y < target.y + 24;
          const side = reverseAnchors(reverse, i);
          const ahead = [beside(reverse, Math.max(0, i - Math.round(cab / DS)), 0, 0)];
          return mouth ? [...ahead, ...side] : [...side, ...ahead];
        },
      },
    ];
  },
  'dock-ramp': ({ params, startState, contacts }) => {
    const target = exerciseById('dock-ramp').target.pose;
    const R = 15;
    const REAR_X = 62;
    const out = pursue(
      params,
      startState,
      contacts,
      [
        { x: 66, y: 25 },
        { x: 74, y: 21.5 },
        { x: 120, y: 21.5 },
      ],
      (s) => s.trailerRear.x >= REAR_X,
    );
    const forward = resample(out.map((s) => frontOf(params, s)));
    const end = out[out.length - 1];
    if (!end) throw new Error('no forward leg');
    const rear = end.trailerRear;
    const reverse = arcs({ x: rear.x, y: rear.y, heading: Math.PI }, [
      { len: rear.x - (target.x + R), k: 0 },
      { len: (R * Math.PI) / 2, k: -1 / R },
      { len: target.y - (rear.y + R), k: 0 },
    ]);
    return [
      {
        gear: 'D',
        path: forward,
        anchors: (i) => forwardAnchors(forward, i),
      },
      {
        gear: 'R',
        path: reverse,
        anchors: (i) => reverseAnchors(reverse, i),
      },
    ];
  },
  'straight-reverse': ({ start }) => {
    const path = straight(start.trailerRear, Math.PI, start.trailerRear.x - 10);
    return [
      {
        gear: 'R',
        path,
        anchors: (i) => [
          beside(path, i, 10, -3),
          beside(path, i, 7, -3),
          beside(path, i, 13, -3.5),
        ],
      },
    ];
  },
  slalom: ({ params, startState, contacts }) => {
    const waypoint = exerciseById('slalom').waypoint ?? { x: 92, y: 20 };
    const within = (r: number) => (s: SimSnapshot) =>
      Math.hypot(s.truck.x - waypoint.x, s.truck.y - waypoint.y) < r;
    const near = within(1.5);
    const out = pursue(params, startState, contacts, [...SLALOM_VIA, waypoint], within(2.4));
    const forward = resample(out.map((s) => frontOf(params, s)));
    const target = exerciseById('slalom').target.pose;
    const reach =
      params.trailerRearOverhang + params.trailerWheelbase + params.drawbar + params.couplingOffset;
    const back = pursue(
      params,
      { truck: { x: target.x + reach, y: target.y, heading: 0 } },
      contacts,
      [...SLALOM_VIA, waypoint],
      near,
    );
    const reverse = resample(back.map((s) => s.trailerRear).reverse());
    return [
      {
        gear: 'D',
        path: forward,
        anchors: (i) => forwardAnchors(forward, i),
      },
      {
        gear: 'R',
        path: reverse,
        anchors: (i) => [
          beside(reverse, i, 5, -3.5),
          beside(reverse, i, 5, 3.5),
          beside(reverse, i, 9, -5),
        ],
      },
    ];
  },
};

/** Every truck with every trailer. */
export const GATE_PAIRS = trucks.flatMap((t) =>
  trailers.map((r) => ({ truck: t.id, trailer: r.id })),
);
/** A case runs for minutes of sim time: well past vitest's default timeout. */
export const GATE_TIMEOUT = 300_000;
/** A passing case; the tests compare the whole outcome so a failure prints `phase`, `position` and `angle`. */
export const GATE_PASS = { reached: true, faults: {}, contacts: 0, jackknifes: 0 } as const;
export const GATE_HINT =
  'the gate Einweiser no longer guides this pair: its LEGS and POLICY (gate-harness.ts) are tuned to the vehicle params, the sight geometry, the layouts and the driver, so a change to any of them can need a retune';
