import { type BufferGeometry, Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { layouts } from '../content/registry';
import { resolveLayout } from '../content/resolve-layout';
import type { RenderFrame, ScenePalette } from '../contracts/render';
import type { Pose2 } from '../contracts/sim';
import {
  bodyOccluders,
  bodyPoints,
  layoutOccluders,
  sightGeometry,
  sightOf,
} from '../einweiser/sight';
import { createSimulation } from '../sim/simulation';
import { trailers, trucks } from '../vehicles/registry';
import { createEinweiserCamera } from './einweiser-camera';
import { KEYS } from './palette';
import {
  AIDS_LAYER,
  CHASE_LAYERS,
  COCKPIT_LAYERS,
  EINWEISER_LAYERS,
  MIRROR_LAYERS,
  SHADOW_CASTER_LAYERS,
  SIGHT_GROUND_LAYER,
} from './seams';
import { CELL, createSightCones, sightRuns } from './sight-cones';

const truck = trucks[0];
const trailer = trailers[0];
if (truck === undefined || trailer === undefined) throw new Error('no vehicles');
const g = sightGeometry(truck, trailer);
const POSE: Pose2 = { x: 2, y: -1, heading: 0.6 };
const snapshot = createSimulation(g.params, { truck: POSE }, () => null).snapshot();
const layout = resolveLayout(layouts.depot, null);
const palette = Object.fromEntries(Object.keys(KEYS).map((k) => [k, 0x808080])) as ScenePalette;

const area = (runs: readonly { from: number; to: number }[]): number =>
  runs.reduce((sum, r) => sum + (r.to - r.from) * CELL, 0);

describe('sightRuns', () => {
  const occluders = layoutOccluders(layout);
  const runs = sightRuns(g, snapshot, occluders);
  const at = (x: number, y: number): 'direct' | 'mirror' | null => {
    const hit = (list: typeof runs.direct): boolean =>
      list.some((r) => r.y <= y && y < r.y + CELL && r.from <= x && x < r.to);
    return hit(runs.direct) ? 'direct' : hit(runs.mirror) ? 'mirror' : null;
  };

  it('is what the scoring sees at each cell centre, for his head and chest', () => {
    const bodies = bodyOccluders(g, snapshot);
    let checked = 0;
    let seen = 0;
    for (let i = -14; i < 14; i++) {
      for (let j = -14; j < 14; j++) {
        const [x, y] = [POSE.x + (i + 0.5) * CELL * 1.7, POSE.y + (j + 0.5) * CELL * 1.7];
        const [cx, cy] = [(Math.floor(x / CELL) + 0.5) * CELL, (Math.floor(y / CELL) + 0.5) * CELL];
        const inBlocker = [...bodies, ...occluders].some(({ obb: o }) => {
          const [c, s] = [Math.cos(o.heading), Math.sin(o.heading)];
          const [dx, dy] = [cx - o.cx, cy - o.cy];
          return (
            Math.abs(c * dx + s * dy) <= o.halfLength && Math.abs(-s * dx + c * dy) <= o.halfWidth
          );
        });
        if (inBlocker) continue;
        const sight = sightOf(g, snapshot, bodyPoints({ x: cx, y: cy }), occluders);
        const expected = sight.direct ? 'direct' : sight.mirrors.length > 0 ? 'mirror' : null;
        expect(at(cx, cy), `${cx}, ${cy}`).toBe(expected);
        checked++;
        if (expected !== null) seen++;
      }
    }
    expect(checked).toBeGreaterThan(400);
    expect(seen).toBeGreaterThan(100);
  });

  it('draws both the direct and the mirror-only area', () => {
    expect(area(runs.direct)).toBeGreaterThan(10);
    expect(area(runs.mirror)).toBeGreaterThan(1);
  });

  it('loses what a blocker on the sight line hides', () => {
    const open = sightRuns(g, snapshot, []);
    const wall = {
      obb: { cx: POSE.x + 12, cy: POSE.y, halfLength: 0.5, halfWidth: 12, heading: 0 },
      height: 4,
    };
    const shaded = sightRuns(g, snapshot, [wall]);
    expect(area(shaded.direct)).toBeLessThan(area(open.direct));
  });
});

describe('the sight cones in the scene', () => {
  const cones = createSightCones(truck, trailer, layout, palette);
  const frame = (einweiser: boolean): RenderFrame =>
    ({
      snapshot,
      ...(einweiser ? { einweiser: { pose: POSE, pitch: 0, sign: null, phase: 0 } } : {}),
    }) as RenderFrame;
  const visible = (): boolean[] => cones.object.children.map((m) => m.visible);

  it('puts the top-down meshes on the aids layer and the ground ones on a layer of his camera alone', () => {
    const layers = cones.object.children.map((m) => [
      m.layers.isEnabled(AIDS_LAYER),
      m.layers.isEnabled(SIGHT_GROUND_LAYER),
    ]);
    expect(layers.filter(([top, ground]) => top === true && ground === false)).toHaveLength(2);
    expect(layers.filter(([top, ground]) => top === false && ground === true)).toHaveLength(2);
    expect(EINWEISER_LAYERS).toContain(SIGHT_GROUND_LAYER);
    for (const others of [COCKPIT_LAYERS, MIRROR_LAYERS, CHASE_LAYERS, SHADOW_CASTER_LAYERS]) {
      expect(others).not.toContain(SIGHT_GROUND_LAYER);
    }
    expect(createEinweiserCamera().layers.isEnabled(SIGHT_GROUND_LAYER)).toBe(true);
  });

  it('shows each pair by its own flag, in an Einweiser run only', () => {
    cones.setFlags({ top: true, ground: false });
    cones.update(frame(true));
    expect(visible()).toEqual([true, false, true, false]);
    cones.setFlags({ top: false, ground: true });
    cones.update(frame(true));
    expect(visible()).toEqual([false, true, false, true]);
    cones.setFlags({ top: true, ground: true });
    cones.update(frame(false));
    expect(visible()).toEqual([false, false, false, false]);
  });

  it('has sampled the footprint by the first frame it shows', () => {
    const fresh = createSightCones(truck, trailer, layout, palette);
    fresh.setFlags({ top: true, ground: false });
    fresh.update(frame(true));
    const drawn = fresh.object.children.map((m) => {
      if (!(m instanceof Mesh)) throw new Error('not a mesh');
      return (m.geometry as BufferGeometry).drawRange.count;
    });
    expect(drawn[0]).toBeGreaterThan(0);
    expect(drawn[2]).toBeGreaterThan(0);
    fresh.dispose();
  });
});
