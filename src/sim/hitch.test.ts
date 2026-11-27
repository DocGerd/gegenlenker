import { describe, expect, it } from 'vitest';
import type {
  ContactQuery,
  ControlVector,
  ParkedTrailer,
  Simulation,
  SimSnapshot,
  StartState,
} from '../contracts/sim';
import type { VehicleParams } from '../contracts/vehicle';
import { resolveCombination, resolveJaw } from '../vehicles/resolve';
import { trailers, trucks } from '../vehicles/registry';
import { wrapAngle } from './angle';
import { createContactQuery } from './collision';
import { DRAWBAR_WIDTH, DT, V_MAX } from './constants';
import { drivenRig, jawOffset } from './hitch';
import { predictCombination } from './predict';
import { createSimulation } from './simulation';

const CAP = 20_000;
const noContacts: ContactQuery = () => null;
const PARKED: ParkedTrailer = { eye: { x: 0, y: 0 }, heading: 0, turntable: 0 };
const pairs = trucks.flatMap((truck) =>
  trailers.map((trailer) => ({
    name: `${truck.id} + ${trailer.id}`,
    p: resolveCombination(truck, trailer),
    jaw: resolveJaw(truck),
  })),
);

const ctl = (c: Partial<ControlVector>): ControlVector => ({
  steer: 0,
  lever: 0,
  brake: false,
  gear: 'D',
  ...c,
});

/** The truck straight at `angle` to the drawbar, its jaw `gap` m ahead of the eye on a line meeting it `lateral` m to the left. */
function approach(p: VehicleParams, lateral: number, angle: number, gap = 1): StartState['truck'] {
  const jaw = { x: gap, y: lateral + gap * Math.tan(angle) };
  return {
    x: jaw.x + p.couplingOffset * Math.cos(angle),
    y: jaw.y + p.couplingOffset * Math.sin(angle),
    heading: angle,
  };
}

function parkedSim(
  p: VehicleParams,
  jaw: ReturnType<typeof resolveJaw>,
  truck: StartState['truck'],
  contacts = noContacts,
): Simulation {
  return createSimulation(p, { truck, parked: { trailer: PARKED, jaw } }, contacts);
}

/** Reverses at `lever` until coupled, blocked or `limit` m past the eye. */
function reverse(sim: Simulation, lever: number, limit = 1): SimSnapshot {
  let s = sim.snapshot();
  for (let i = 0; i < CAP && s.hitch?.coupled === false && s.blocked === null; i++) {
    s = sim.step(ctl({ gear: 'R', lever }));
    if (s.coupling.x < -limit) break;
  }
  return s;
}

describe.each(pairs)('$name', ({ p, jaw }) => {
  it('stands parked: the truck drives off alone and the trailer stays put', () => {
    const sim = parkedSim(p, jaw, approach(p, 0, 0, 5));
    const before = sim.snapshot();
    let s = before;
    for (let i = 0; i < 300; i++) s = sim.step(ctl({ lever: 1, steer: 0.5 }));
    expect(s.truck).not.toEqual(before.truck);
    expect([s.dolly, s.trailer, s.trailerRear]).toEqual([
      before.dolly,
      before.trailer,
      before.trailerRear,
    ]);
    expect(s.hitch).toEqual({ coupled: false, eye: PARKED.eye, couplingSpeed: null });
    expect(s.dolly.x).toBeCloseTo(-p.drawbar, 12);
  });

  // Inside the catch the jaw meets the eye before the frame end meets the drawbar.
  it.each([
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ])('couples at the corner of the catch (%i, %i), clean', (side, turn) => {
    const sim = parkedSim(p, jaw, approach(p, 0.95 * side * jaw.width, 0.95 * turn * jaw.angle));
    const parked = sim.snapshot();
    const s = reverse(sim, 0.2);
    expect(s.hitch?.coupled).toBe(true);
    expect(s.contacts).toBe(0);
    expect(s.speed).toBe(0);
    // the drawbar swung about the turntable onto the jaw; the trailer kept its heading and its turntable moved at most a step
    expect(s.trailer.heading).toBe(parked.trailer.heading);
    expect(Math.hypot(s.dolly.x - parked.dolly.x, s.dolly.y - parked.dolly.y)).toBeLessThanOrEqual(
      V_MAX * DT + 1e-3,
    );
    expect(Math.abs(wrapAngle(s.dolly.heading - PARKED.heading))).toBeLessThan(
      (1.01 * jaw.width) / p.drawbar,
    );
  });

  it.each([
    ['beside the catch', 1.2, 0],
    ['at an angle beyond it', 0, 1.3],
  ])('misses %s: the truck meets the drawbar', (_, lateral, angle) => {
    const sim = parkedSim(p, jaw, approach(p, lateral * jaw.width, angle * jaw.angle));
    const s = reverse(sim, 0.2);
    expect(s.hitch?.coupled).toBe(false);
    expect(s.blocked).toBe('contact');
    expect(s.contact).toMatchObject({ body: 'drawbar', self: true });
    expect(s.contacts).toBe(1);
  });

  it('closes at any approach speed and keeps the fastest', () => {
    const sim = parkedSim(p, jaw, approach(p, 0, 0, 3));
    const s = reverse(sim, 1);
    expect(s.hitch?.coupled).toBe(true);
    expect(s.hitch?.couplingSpeed).toBeGreaterThan(0.9 * V_MAX);
  });

  it('uncouples only at a standstill, and couples again on reversing', () => {
    const sim = parkedSim(p, jaw, approach(p, 0, 0, 1));
    reverse(sim, 0.2);
    let s = sim.step(ctl({ gear: 'D', lever: 0.5 }));
    for (let i = 0; i < 60; i++) s = sim.step(ctl({ gear: 'D', lever: 0.5 }));
    expect(s.speed).toBeGreaterThan(0);
    s = sim.step(ctl({ gear: 'D', lever: 0.5, uncouple: true }));
    expect(s.hitch?.coupled).toBe(true);
    for (let i = 0; i < 120 && s.speed !== 0; i++) s = sim.step(ctl({ brake: true }));
    s = sim.step(ctl({ brake: true, uncouple: true }));
    expect(s.hitch?.coupled).toBe(false);
    expect(s.control.uncouple).toBe(true);
    const dropped = s.trailer;
    for (let i = 0; i < 200; i++) s = sim.step(ctl({ gear: 'D', lever: 0.5 }));
    expect(s.trailer).toEqual(dropped);
    expect(
      jawOffset(s.coupling, s.hitch?.eye ?? s.coupling, s.dolly.heading).along,
    ).toBeGreaterThan(1);
    expect(reverse(sim, 0.2).hitch?.coupled).toBe(true);
  });

  it('the parked drawbar blocks the predicted path of a truck reversing past the eye', () => {
    const sim = parkedSim(p, jaw, approach(p, 1.2 * jaw.width, 0, 3));
    const s = sim.step(ctl({ gear: 'R', lever: 0.2 }));
    const rig = drivenRig(p, s, noContacts);
    const predicted = predictCombination(rig.params, s, rig.contacts);
    expect(predicted.blocked).toBe('contact');
    expect(predicted.blockedAt).toBeGreaterThan(2.9);
    expect(predicted.blockedAt).toBeLessThan(3.3);
    // coupled, the rig is the whole combination again
    const coupled = parkedSim(p, jaw, approach(p, 0, 0, 0.5));
    const joined = reverse(coupled, 0.2);
    expect(drivenRig(p, joined, noContacts).params).toBe(p);
  });
});

it('keeps the catch inside the frame end for every truck, so a clean approach meets no drawbar', () => {
  for (const truck of trucks) {
    const jaw = resolveJaw(truck);
    const clearance = (truck.couplingOffset.value - truck.rearOverhang.value) / 1000;
    expect((DRAWBAR_WIDTH / 2 + jaw.width) * Math.sin(jaw.angle), truck.id).toBeLessThan(clearance);
  }
});

it('leaves a run without a parked trailer as it was: no hitch in its snapshot', () => {
  const [pair] = pairs;
  if (pair === undefined) throw new Error('no pair');
  const sim = createSimulation(
    pair.p,
    { truck: { x: 0, y: 0, heading: 0 } },
    createContactQuery([]),
  );
  const s = sim.step(ctl({ lever: 1, uncouple: true }));
  expect('hitch' in s).toBe(false);
  expect(s.control).toEqual({ steer: 0, lever: 1, brake: false, gear: 'D', uncouple: true });
});
