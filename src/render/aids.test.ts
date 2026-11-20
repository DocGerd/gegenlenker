import type { Mesh, MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { layouts } from '../content/registry';
import { resolveLayout } from '../content/resolve-layout';
import type { RenderFrame, ScenePalette } from '../contracts/render';
import type {
  ControlVector,
  Obb,
  Prediction,
  SimSnapshot,
  Simulation,
  Vec2,
} from '../contracts/sim';
import { bodyFootprints } from '../sim/geometry';
import { predictCombination } from '../sim/predict';
import { createSimulation } from '../sim/simulation';
import { resolveCombination } from '../vehicles/resolve';
import { trailerById, truckById } from '../vehicles/registry';
import { dashSegments, proceduralAids } from './aids';
import { lookFor } from './look';
import { KEYS } from './palette';
import { QUALITY_FLAGS } from './quality';
import { AID_DASH_OFF, AID_DASH_ON, AID_STROKE } from './seams';

type Dash = { from: Vec2; to: Vec2 };

const dashes = (line: readonly Vec2[], on: number, off: number): Dash[] => {
  const out: Dash[] = [];
  dashSegments(line, on, off, (ax, ay, bx, by) =>
    out.push({ from: { x: ax, y: ay }, to: { x: bx, y: by } }),
  );
  return out;
};

const total = (ds: readonly Dash[]): number =>
  ds.reduce((sum, d) => sum + Math.hypot(d.to.x - d.from.x, d.to.y - d.from.y), 0);

const straight = (length: number, spacing: number): Vec2[] => {
  const n = Math.round(length / spacing);
  return Array.from({ length: n + 1 }, (_, i) => ({ x: (i * length) / n, y: 0 }));
};

describe('dashSegments', () => {
  it('lays on/period of the length down as dashes, independent of the vertex spacing', () => {
    for (const spacing of [0.3, 0.5]) {
      expect(total(dashes(straight(30, spacing), 0.6, 0.4))).toBeCloseTo(18, 6);
    }
  });

  it('measures the pattern along the line, so dashes start at each period', () => {
    for (const spacing of [0.3, 0.5]) {
      // a dash crossing a vertex is emitted in pieces; a start is a piece that does not continue the last
      const pieces = dashes(straight(3, spacing), 0.6, 0.4);
      const starts = pieces
        .filter((d, i) => i === 0 || d.from.x - (pieces[i - 1]?.to.x ?? 0) > 1e-9)
        .map((d) => d.from.x);
      expect(starts).toHaveLength(3);
      [0, 1, 2].forEach((x, i) => expect(starts[i]).toBeCloseTo(x, 9));
    }
  });

  it('terminates on a long chord, where float error leaves a sliver at the end of a dash', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    expect(total(dashes(line, 0.6, 0.4))).toBeCloseTo(6, 6);
  });
});

const truck = truckById('man-le-18-280');
const trailer = trailerById('krone-azw-18');
const resolved = resolveCombination(truck, trailer);

describe('the predicted corridor', () => {
  // wide limits: a held reverse steer then folds the combination only after the checked 3 m
  const p = { ...resolved, couplingLimit: 3.1, turntableLimit: 3.1 };
  const inside = (o: Obb, q: Vec2): boolean => {
    const [dx, dy] = [q.x - o.cx, q.y - o.cy];
    const [c, s] = [Math.cos(o.heading), Math.sin(o.heading)];
    return Math.abs(dx * c + dy * s) <= o.halfLength && Math.abs(dy * c - dx * s) <= o.halfWidth;
  };
  const control = (steer: number, gear: 'D' | 'R', lever: number): ControlVector => ({
    steer,
    lever,
    brake: false,
    gear,
  });
  const arcs = (line: readonly Vec2[]): number[] => {
    let total = 0;
    return line.map((q, i) => {
      const prev = line[i - 1];
      if (prev !== undefined) total += Math.hypot(q.x - prev.x, q.y - prev.y);
      return total;
    });
  };
  const nearestArc = (line: readonly Vec2[], arc: readonly number[], q: Vec2): number => {
    let [best, bestDistance] = [0, Infinity];
    line.forEach((c, i) => {
      const d = Math.hypot(c.x - q.x, c.y - q.y);
      if (d < bestDistance) [best, bestDistance] = [i, d];
    });
    return arc[best] ?? 0;
  };
  /** What is drawn, as midpoints: the solid segments in R, the dashes in D. */
  const drawn = (line: readonly Vec2[], gear: 'D' | 'R'): Vec2[] => {
    const mids: Vec2[] = [];
    const add = (ax: number, ay: number, bx: number, by: number): void => {
      mids.push({ x: (ax + bx) / 2, y: (ay + by) / 2 });
    };
    if (gear === 'D') dashSegments(line, AID_DASH_ON, AID_DASH_OFF, add);
    else {
      line.forEach((b, i) => {
        const a = line[i - 1];
        if (a !== undefined) add(a.x, a.y, b.x, b.y);
      });
    }
    return mids;
  };
  /** The lead end's centre: the trailer rear in R, the truck front in D. */
  const leadCentre = (gear: 'D' | 'R', s: SimSnapshot): Vec2 =>
    gear === 'R'
      ? s.trailerRear
      : {
          x: s.truck.x + p.truckFront * Math.cos(s.truck.heading),
          y: s.truck.y + p.truckFront * Math.sin(s.truck.heading),
        };

  /** A standstill at a slight coupling angle, or a start with the steer settled and the combination moving. */
  const scenario = (
    gear: 'D' | 'R',
    steer: number,
    degrees: number,
  ): { sim: Simulation; from: SimSnapshot } => {
    const sim = createSimulation(
      p,
      { truck: { x: 0, y: 0, heading: 0 }, couplingAngle: (degrees * Math.PI) / 180 },
      () => null,
    );
    if (steer === 0) return { sim, from: sim.step(control(0, gear, 0)) };
    let from = sim.snapshot();
    for (let i = 0; i < 4000 && !(from.steer === steer && Math.abs(from.speed) >= 1); i++) {
      from = sim.step(control(steer, gear, 1));
    }
    expect(from.steer).toBe(steer);
    return { sim, from };
  };

  it('draws nothing of the lines ahead of the leading end under the bodies as they drive on', () => {
    const cases = [
      [0, 0],
      [0, 2],
      [0, -2],
      [0.6, 0],
      [-0.6, 0],
    ] as const;
    for (const gear of ['D', 'R'] as const) {
      for (const [steer, degrees] of cases) {
        const { sim, from } = scenario(gear, steer, degrees);
        const predicted = predictCombination(p, from, () => null, 8);
        const lines = [predicted.left, predicted.right].map((line) => ({
          mids: drawn(line, gear),
          line,
          arc: arcs(line),
        }));
        let [travelled, previous, checked] = [0, leadCentre(gear, from), 0];
        for (let i = 0; i < 20000 && travelled < 3; i++) {
          const now = sim.step(control(from.control.steer, gear, 1));
          const centre = leadCentre(gear, now);
          travelled += Math.hypot(centre.x - previous.x, centre.y - previous.y);
          previous = centre;
          const bodies = bodyFootprints(p, now);
          for (const { mids, line, arc } of lines) {
            for (const mid of mids) {
              // a generous margin keeps the corner's own arc, which differs from the centre's, out of it
              if (nearestArc(line, arc, mid) < 1.2 * travelled + 0.5) continue;
              checked++;
              expect(bodies.some((b) => inside(b.obb, mid))).toBe(false);
            }
          }
        }
        expect(travelled).toBeGreaterThanOrEqual(3);
        expect(checked).toBeGreaterThan(0);
      }
    }
  });
});

describe('the aids layer corridor', () => {
  const p = resolved;
  const palette = Object.fromEntries(Object.keys(KEYS).map((k) => [k, 0x808080])) as ScenePalette;
  const layer = proceduralAids(truck, trailer, resolveLayout(layouts.depot, null), palette);
  const [solid0, solid1, dashed0, dashed1, bar] = layer.object.children;
  const meshOf = (group: unknown, i: number): Mesh => {
    const mesh = (group as { children: Mesh[] }).children[i];
    if (mesh === undefined) throw new Error('no mesh');
    return mesh;
  };
  const sim = createSimulation(p, { truck: { x: 0, y: 0, heading: 0 } }, () => null);
  const snapshot = sim.snapshot();
  const on = { pivots: true, path: true, tracks: true, ghost: true };
  const left = [
    { x: 0, y: 1 },
    { x: 3, y: 1 },
    { x: 6, y: 2 },
  ];
  const right = left.map((q) => ({ x: q.x, y: q.y - 2 }));
  const prediction = (over: Partial<Prediction>): Prediction => ({
    lead: 'trailer',
    left,
    right,
    blocked: 'contact',
    blockedAt: 6,
    ...over,
  });
  const show = (predicted: Prediction, path = true): void => {
    const frame: RenderFrame = {
      snapshot,
      views: {
        cockpit: null,
        mirrorLeft: null,
        mirrorRight: null,
        topDown: { x: 0, y: 0, width: 1, height: 1 },
      },
      topDown: 'follow',
      aids: { ...on, path },
      predicted,
    };
    layer.update(frame);
  };
  /** The two ends of the segment drawn in slot 0 of the core ribbon, in the sim plane. */
  const barEnds = (): [Vec2, Vec2] => {
    const positions = meshOf(bar, 1).geometry.getAttribute('position');
    const at = (a: number, b: number): Vec2 => ({
      x: (positions.getX(a) + positions.getX(b)) / 2,
      y: -(positions.getZ(a) + positions.getZ(b)) / 2,
    });
    return [at(0, 1), at(2, 3)];
  };
  const visible = (): boolean[] =>
    [solid0, solid1, dashed0, dashed1, bar].map((o) => o?.visible ?? false);
  const near = (a: Vec2, b: Vec2): void => {
    expect(a.x).toBeCloseTo(b.x, 5);
    expect(a.y).toBeCloseTo(b.y, 5);
  };

  it('draws a stop bar across the last sample only when the prediction is blocked', () => {
    show(prediction({}));
    expect(visible()[4]).toBe(true);
    const [a, b] = barEnds();
    near(a, { x: 6, y: 2 });
    near(b, { x: 6, y: 0 });
    show(prediction({ blocked: null, blockedAt: null }));
    expect(visible()[4]).toBe(false);
  });

  it('draws the lines solid behind the trailer and dashed ahead of the truck', () => {
    show(prediction({ lead: 'trailer' }));
    expect(visible().slice(0, 4)).toEqual([true, true, false, false]);
    show(prediction({ lead: 'truck' }));
    expect(visible().slice(0, 4)).toEqual([false, false, true, true]);
  });

  it('hides every corridor part when the predicted path aid is off', () => {
    show(prediction({}), false);
    expect(visible()).toEqual([false, false, false, false, false]);
  });

  it('moves the bar clear of the leading body when the block is at the first sample', () => {
    const clear = AID_STROKE.bar / 2 + AID_STROKE.casing;
    const first = { left: [{ x: 0, y: 1 }], right: [{ x: 0, y: -1 }] };
    show(prediction({ ...first, lead: 'trailer' }));
    let [a, b] = barEnds();
    near(a, { x: -clear, y: 1 });
    near(b, { x: -clear, y: -1 });
    show(prediction({ ...first, lead: 'truck' }));
    [a, b] = barEnds();
    near(a, { x: clear, y: 1 });
    near(b, { x: clear, y: -1 });
  });
});

describe('the aids layer at night', () => {
  const palette = {
    ...Object.fromEntries(Object.keys(KEYS).map((k) => [k, 0x808080])),
    accent: 0xff0000,
    nightAccent: 0x00ffff,
    tracks: 0x0000ff,
    nightTracks: 0xffff00,
    wheel: 0x101010,
  } as ScenePalette;
  const colourOf = (mesh: unknown): number =>
    ((mesh as Mesh).material as MeshBasicMaterial).color.getHex();

  it('draws the accent and track strokes in their night colours, and the casings as by day', () => {
    const layer = proceduralAids(truck, trailer, resolveLayout(layouts.depot, null), palette);
    const group = layer.object.children[0] as unknown as { children: Mesh[] };
    const track = layer.object.children[layer.object.children.length - 1];
    const strokes = (): number[] => [
      colourOf(group.children[0]),
      colourOf(group.children[1]),
      colourOf(track),
    ];
    expect(strokes()).toEqual([0x101010, 0xff0000, 0x0000ff]);
    for (const preset of ['low', 'high'] as const) {
      layer.setLook(lookFor(QUALITY_FLAGS[preset], 'night'));
      expect(strokes(), preset).toEqual([0x101010, 0x00ffff, 0xffff00]);
    }
    layer.setLook(lookFor(QUALITY_FLAGS.low, 'day'));
    expect(strokes()).toEqual([0x101010, 0xff0000, 0x0000ff]);
    layer.dispose();
  });
});
