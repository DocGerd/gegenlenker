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
import { STEP_HEIGHT } from '../einweiser/walk';
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
import { CELL, createSightCones, sightRuns, type Run } from './sight-cones';

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

/** Kerb high, so he stands on it: a box broad enough to hold cell centres, front left where the driver looks. */
const KERB = {
  obb: { cx: POSE.x + 3, cy: POSE.y + 5, halfLength: 2, halfWidth: 1.5, heading: 0.6 },
  height: 0.15,
};

describe('sightRuns', () => {
  const occluders = [...layoutOccluders(layout), KERB];
  const runs = sightRuns(g, snapshot, occluders);
  const at = (x: number, y: number): 'direct' | 'mirror' | null => {
    const hit = (list: typeof runs.direct): boolean =>
      list.some((r) => r.y <= y && y < r.y + CELL && r.from <= x && x < r.to);
    return hit(runs.direct) ? 'direct' : hit(runs.mirror) ? 'mirror' : null;
  };

  it('is what the scoring sees at each cell centre he can stand on, for his head and chest', () => {
    const bodies = bodyOccluders(g, snapshot);
    const inside = ({ obb: o }: { obb: typeof KERB.obb }, [x, y]: readonly [number, number]) => {
      const [c, s] = [Math.cos(o.heading), Math.sin(o.heading)];
      const [dx, dy] = [x - o.cx, y - o.cy];
      return Math.abs(c * dx + s * dy) <= o.halfLength && Math.abs(-s * dx + c * dy) <= o.halfWidth;
    };
    let checked = 0;
    let seen = 0;
    let onKerb = 0;
    let seenOnKerb = 0;
    for (let i = -14; i < 14; i++) {
      for (let j = -14; j < 14; j++) {
        const [x, y] = [POSE.x + (i + 0.5) * CELL * 1.7, POSE.y + (j + 0.5) * CELL * 1.7];
        const [cx, cy] = [(Math.floor(x / CELL) + 0.5) * CELL, (Math.floor(y / CELL) + 0.5) * CELL];
        // he walks over anything lower than a step (`walkStep`), so only taller boxes are left out
        const blocked = [...bodies, ...occluders].some(
          (o) => o.height >= STEP_HEIGHT && inside(o, [cx, cy]),
        );
        if (blocked) continue;
        const sight = sightOf(g, snapshot, bodyPoints({ x: cx, y: cy }), occluders);
        const expected = sight.direct ? 'direct' : sight.mirrors.length > 0 ? 'mirror' : null;
        expect(at(cx, cy), `${cx}, ${cy}`).toBe(expected);
        checked++;
        if (expected !== null) seen++;
        if (inside(KERB, [cx, cy])) {
          onKerb++;
          if (expected !== null) seenOnKerb++;
        }
      }
    }
    expect(checked).toBeGreaterThan(400);
    expect(seen).toBeGreaterThan(100);
    expect(onKerb).toBeGreaterThan(4);
    expect(seenOnKerb).toBeGreaterThan(0);
  });

  it('draws both the direct and the mirror-only area', () => {
    expect(area(runs.direct)).toBeGreaterThan(10);
    expect(area(runs.mirror)).toBeGreaterThan(1);
  });

  it('loses the ground a wall hides behind it', () => {
    const wall = {
      obb: { cx: POSE.x + 12, cy: POSE.y, halfLength: 0.5, halfWidth: 12, heading: 0 },
      height: 4,
    };
    // the length of rows past the wall, within its span
    const behind = (list: readonly Run[]): number =>
      list
        .filter((r) => r.y >= POSE.y - 12 && r.y + CELL <= POSE.y + 12)
        .reduce((sum, r) => sum + Math.max(0, r.to - Math.max(r.from, POSE.x + 12.5)), 0);
    const open = sightRuns(g, snapshot, []);
    const shaded = sightRuns(g, snapshot, [wall]);
    expect(behind(open.direct)).toBeGreaterThan(10);
    expect(behind(shaded.direct) + behind(shaded.mirror)).toBe(0);
  });
});

describe('the truck solo', () => {
  const solo = sightGeometry(truck, null);
  const first = createSimulation(solo.params, { truck: POSE }, () => null).snapshot();
  const runs = sightRuns(solo, first, []);

  it('has its truck as the only body, and the sight check agrees at each cell it draws', () => {
    expect(bodyOccluders(solo, first).map((b) => b.body)).toEqual(['truck']);
    expect(area(runs.direct)).toBeGreaterThan(10);
    expect(area(runs.mirror)).toBeGreaterThan(1);
    const [row] = runs.direct;
    if (row === undefined) throw new Error('no direct run');
    const [x, y] = [row.from + CELL / 2, row.y + CELL / 2];
    expect(sightOf(solo, first, bodyPoints({ x, y }), []).direct).toBe(true);
  });

  it('is sampled by the cones without a trailer', () => {
    const cones = createSightCones(truck, null, layout, palette, () => 0);
    cones.setFlags({ top: true, ground: false });
    cones.update({
      snapshot: first,
      views: { topDown: { x: 0, y: 0, width: 400, height: 300 } },
      einweiser: { pose: POSE, pitch: 0, sign: null, phase: 0 },
    } as RenderFrame);
    expect(cones.pending()).toBe(false);
    expect(cones.object.children.map((m) => m.visible)).toEqual([true, false, true, false]);
    cones.dispose();
  });
});

describe('the sight cones in the scene', () => {
  // a clock that never moves: each update samples to the end, as in the pinned e2e shots
  const cones = createSightCones(truck, trailer, layout, palette, () => 0);
  const PANE = { x: 0, y: 0, width: 400, height: 300 };
  const frame = (einweiser: boolean, topDown = PANE): RenderFrame =>
    ({
      snapshot,
      views: { topDown },
      ...(einweiser ? { einweiser: { pose: POSE, pitch: 0, sign: null, phase: 0 } } : {}),
    }) as RenderFrame;
  const visible = (c = cones): boolean[] => c.object.children.map((m) => m.visible);
  const geometries = (c = cones): BufferGeometry[] =>
    c.object.children.map((m) => {
      if (!(m instanceof Mesh)) throw new Error('not a mesh');
      return m.geometry as BufferGeometry;
    });
  const drawn = (c = cones): number[] => geometries(c).map((geo) => geo.drawRange.count);

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
    expect(drawn()[0]).toBeGreaterThan(0);
    cones.setFlags({ top: false, ground: true });
    cones.update(frame(true));
    expect(visible()).toEqual([false, true, false, true]);
    cones.setFlags({ top: true, ground: true });
    cones.update(frame(false));
    expect(visible()).toEqual([false, false, false, false]);
  });

  it('neither draws nor samples the top-down pair without a top view, and holds no buffers then', () => {
    const fresh = createSightCones(truck, trailer, layout, palette, () => 0);
    fresh.setFlags({ top: true, ground: false });
    fresh.update(frame(true, { ...PANE, width: 0, height: 0 }));
    expect(visible(fresh)).toEqual([false, false, false, false]);
    expect(fresh.pending()).toBe(false);
    expect(geometries(fresh).map((geo) => geo.getAttribute('position'))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    fresh.dispose();
  });

  it('spends its budget cell by cell, and shows nothing until the footprint is done', () => {
    const runs = sightRuns(g, snapshot, layoutOccluders(layout));
    const shownCells = [...runs.direct, ...runs.mirror].reduce(
      (sum, r) => sum + (r.to - r.from) / CELL,
      0,
    );
    // each reading is past the budget of the last: an update samples one cell
    let time = 0;
    const fresh = createSightCones(truck, trailer, layout, palette, () => (time += 5));
    fresh.setFlags({ top: true, ground: false });
    let updates = 0;
    do {
      fresh.update(frame(true));
      updates++;
      if (fresh.pending()) expect(visible(fresh)).toEqual([false, false, false, false]);
    } while (fresh.pending());
    // a frame per cell, the empty ones too: more frames than drawn cells, where a row per frame takes fewer
    expect(updates).toBeGreaterThan(shownCells);
    expect(visible(fresh)).toEqual([true, false, true, false]);
    expect(drawn(fresh)[0]).toBeGreaterThan(0);

    // off and on again: the old footprint stays hidden until a new one is done
    fresh.setFlags({ top: false, ground: false });
    fresh.update(frame(true));
    fresh.setFlags({ top: true, ground: false });
    fresh.update(frame(true));
    expect(fresh.pending()).toBe(true);
    expect(visible(fresh)).toEqual([false, false, false, false]);
    fresh.dispose();
  });
});
