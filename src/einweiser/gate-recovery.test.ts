import { describe, expect, it } from 'vitest';
import type { Pose2 } from '../contracts/sim';
import { wrapAngle } from '../sim/angle';
import { couplingAngle, turntableAngle, type KinematicState } from '../sim/kinematics';
import { createSimulation } from '../sim/simulation';
import { resolveCombination } from '../vehicles/resolve';
import { trailers, trucks } from '../vehicles/registry';
import { dubinsPaths, endOf, rejoin, type Waypoint, straighten } from './gate-recovery';

describe('dubinsPaths', () => {
  const R = 18;
  const from: Pose2 = { x: 0, y: 0, heading: 0 };
  const goals: Pose2[] = [
    { x: 40, y: 10, heading: 0 },
    { x: 20, y: -30, heading: -Math.PI / 2 },
    { x: -10, y: 25, heading: Math.PI },
    { x: 5, y: 2, heading: 2.5 },
  ];

  it.each(goals)('every path ends on ($x, $y) heading $heading', (to) => {
    const paths = dubinsPaths(from, to, R);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      const end = endOf(from, path);
      expect(Math.hypot(end.x - to.x, end.y - to.y)).toBeLessThan(1e-6);
      expect(Math.abs(wrapAngle(end.heading - to.heading))).toBeLessThan(1e-9);
      for (const s of path) expect(s.k === 0 || Math.abs(Math.abs(s.k) - 1 / R) < 1e-12).toBe(true);
    }
    const lengths = paths.map((p) => p.reduce((sum, s) => sum + s.len, 0));
    expect(lengths).toEqual([...lengths].sort((a, b) => a - b));
  });

  it('is a plain straight when the goal lies dead ahead', () => {
    const [best] = dubinsPaths(from, { x: 30, y: 0, heading: 0 }, R);
    expect(best?.map((s) => Math.round(s.len * 1e6) / 1e6)).toEqual([0, 30, 0]);
  });
});

describe('straighten', () => {
  const truck = trucks[1];
  const trailer = trailers[1];
  if (!truck || !trailer) throw new Error('no vehicles');
  const p = resolveCombination(truck, trailer);
  const bent = (): KinematicState => {
    const s = createSimulation(
      p,
      { truck: { x: 0, y: 0, heading: 0.4 }, couplingAngle: 0.3, turntableAngle: -0.25 },
      () => null,
    ).snapshot();
    return {
      x: s.truck.x,
      y: s.truck.y,
      th0: s.truck.heading,
      th1: s.dolly.heading,
      th2: s.trailer.heading,
    };
  };

  it('pulls forward along the truck heading until both joints are within tolerance', () => {
    const { distance, state } = straighten(p, bent(), 0.02, 60, () => true);
    expect(Math.abs(couplingAngle(state))).toBeLessThanOrEqual(0.02);
    expect(Math.abs(turntableAngle(state))).toBeLessThanOrEqual(0.02);
    expect(state.th0).toBeCloseTo(0.4, 12);
    expect(Math.hypot(state.x, state.y)).toBeCloseTo(distance, 6);
    // a tighter tolerance takes longer
    expect(straighten(p, bent(), 0.005, 60, () => true).distance).toBeGreaterThan(distance);
  });

  it('stops before a step that is not clear', () => {
    const { distance } = straighten(p, bent(), 0.02, 60, (q) => Math.hypot(q.x, q.y) < 3);
    expect(distance).toBeGreaterThan(2.9);
    expect(distance).toBeLessThan(3);
  });
});

describe('rejoin', () => {
  const DS = 0.05;
  const line: Waypoint[] = Array.from({ length: 1201 }, (_, i) => ({ x: i * DS, y: 0, h: 0 }));
  const from: Pose2 = { x: 0, y: 3, heading: 0 };
  const joins = [800, 600, 400, 200];
  const turnOf = (s: { len: number; k: number }): number => Math.abs(s.k) * s.len;
  const all = () => true;

  it('rejoins an offset line exactly, by the shortest loop-free way', () => {
    const way = rejoin(from, line, joins, DS, 18, Math.PI / 2, all);
    if (way === null) throw new Error('no way back');
    const at = line[way.join];
    if (!at) throw new Error('no join');
    const end = endOf(from, way.segments);
    expect(Math.hypot(end.x - at.x, end.y - at.y)).toBeLessThan(1e-6);
    expect(Math.abs(wrapAngle(end.heading - at.h))).toBeLessThan(1e-9);
    expect(Math.max(...way.segments.map(turnOf))).toBeLessThanOrEqual(Math.PI / 2);
    const rest = (line.length - 1 - way.join) * DS;
    expect(way.length).toBeCloseTo(way.segments.reduce((sum, s) => sum + s.len, 0) + rest, 9);
    // no offered join has a shorter loop-free way
    for (const j of joins) {
      const q = line[j];
      if (!q) continue;
      for (const path of dubinsPaths(from, { x: q.x, y: q.y, heading: q.h }, 18)) {
        if (Math.max(...path.map(turnOf)) > Math.PI / 2) continue;
        const total = path.reduce((sum, s) => sum + s.len, 0) + (line.length - 1 - j) * DS;
        expect(total).toBeGreaterThanOrEqual(way.length - 1e-9);
      }
    }
  });

  it('finds nothing when every way back loops or does not fit', () => {
    expect(rejoin(from, line, joins, DS, 18, 0.01, all)).toBeNull();
    expect(rejoin(from, line, joins, DS, 18, Math.PI / 2, () => false)).toBeNull();
  });
});
