import { Box3, Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { exercises, layouts } from '../content/registry';
import { resolveLayout } from '../content/resolve-layout';
import {
  isKitDecor,
  type Collider,
  type Fixture,
  type ObstacleKind,
  type Prop,
  type ResolvedLayout,
} from '../contracts/layout';
import { OVERLAY } from './yard-concrete';
import { cornerHoops, decorPieces, RESTYLED_KINDS, yardProps } from './yard-props';

const TOLERANCE = 0.05;
const MAX_RELIEF = 0.16; // thin relief only, as for seals and dock lights
const FLOAT32 = 1e-4;
const FILLS_FOOTPRINT: readonly ObstacleKind[] = ['parked', 'gatehouse', 'bollard'];
const FILLS_AXES: readonly ObstacleKind[] = ['kerb', 'wall', 'ramp', 'cone'];

const cases = [
  ...Object.values(layouts).map((l) => ({ name: l.id, resolved: resolveLayout(l, null) })),
  ...exercises.map((e) => ({ name: e.id, resolved: resolveLayout(layouts[e.layout], e) })),
];

describe('yard prop coverage', () => {
  it('has a layout or exercise with every kerb, wall, ramp and cone kind', () => {
    for (const kind of FILLS_AXES) {
      const present = cases.some(({ resolved }) => resolved.obstacles.some((o) => o.kind === kind));
      expect(present, kind).toBe(true);
    }
  });

  it('draws a synthetic obstacle of every restyled kind', () => {
    const { resolved } = cases[0] ?? { resolved: undefined };
    if (resolved === undefined) throw new Error('no layout');
    const baseline = yardProps({ ...resolved, obstacles: [], props: [] }).length;
    for (const kind of RESTYLED_KINDS) {
      const obstacle = {
        id: `synthetic-${kind}`,
        kind,
        obb: { cx: 20, cy: 20, halfLength: 2, halfWidth: 0.5, heading: 0 },
        height: 1,
      };
      const drawn = yardProps({ ...resolved, obstacles: [obstacle], props: [] }).length;
      expect(drawn, kind).toBeGreaterThan(baseline);
    }
  });
});

describe.each(cases)('$name yard props', ({ resolved }) => {
  it('draw a detail copy over the whole footprint of solid props', () => {
    const boxes = yardProps(resolved).map((p) => new Box3().setFromObject(new Mesh(p.geometry)));
    const solid = resolved.obstacles.filter((o) => FILLS_FOOTPRINT.includes(o.kind));
    for (const { id, obb } of solid) {
      const { cx, cy, halfLength, halfWidth } = obb;
      const covers = boxes.some(
        (b) =>
          Math.abs(b.min.x - (cx - halfLength)) < TOLERANCE &&
          Math.abs(b.max.x - (cx + halfLength)) < TOLERANCE &&
          Math.abs(b.min.z + (cy + halfWidth)) < TOLERANCE &&
          Math.abs(b.max.z + (cy - halfWidth)) < TOLERANCE,
      );
      expect(covers, id).toBe(true);
    }
  });

  it('fill the footprint of kerbs, walls, ramps and cones without outgrowing it', () => {
    const plot = yardProps({ ...resolved, obstacles: [], props: [] }).length;
    const concrete = resolved.obstacles.filter((o) => FILLS_AXES.includes(o.kind));
    for (const o of concrete) {
      const b = new Box3();
      const own = yardProps({ ...resolved, obstacles: [o], props: [] });
      for (const p of own.slice(0, own.length - plot)) {
        b.union(new Box3().setFromObject(new Mesh(p.geometry)));
      }
      const { cx, cy, heading, halfLength, halfWidth } = o.obb;
      const [c, s] = [Math.abs(Math.cos(heading)), Math.abs(Math.sin(heading))];
      const halfX = c * halfLength + s * halfWidth;
      const halfY = s * halfLength + c * halfWidth;
      expect(b.min.x, o.id).toBeCloseTo(cx - halfX, 1);
      expect(b.max.x, o.id).toBeCloseTo(cx + halfX, 1);
      expect(-b.max.z, o.id).toBeCloseTo(cy - halfY, 1);
      expect(-b.min.z, o.id).toBeCloseTo(cy + halfY, 1);
      expect(b.max.y, o.id).toBeGreaterThanOrEqual(o.height - FLOAT32);
      expect(b.max.y, o.id).toBeLessThanOrEqual(o.height + OVERLAY + FLOAT32);
    }
  });

  it('leave the yard kit to its glb', () => {
    const kit = resolved.decor.filter(isKitDecor);
    expect(kit.length).toBeGreaterThan(0);
    expect(decorPieces(kit)).toEqual([]);
  });

  it('draw decor within its footprint, apart from thin relief', () => {
    for (const d of resolved.decor.filter((d) => !isKitDecor(d))) {
      const [piece] = decorPieces([d]);
      const b = new Box3().setFromObject(new Mesh(piece?.geometry));
      const { cx, cy, heading, halfLength, halfWidth } = d.footprint;
      const [c, s] = [Math.abs(Math.cos(heading)), Math.abs(Math.sin(heading))];
      const halfX = c * halfLength + s * halfWidth + TOLERANCE;
      const halfY = s * halfLength + c * halfWidth + TOLERANCE;
      expect(b.min.x, d.id).toBeGreaterThanOrEqual(cx - halfX);
      expect(b.max.x, d.id).toBeLessThanOrEqual(cx + halfX);
      expect(-b.max.z, d.id).toBeGreaterThanOrEqual(cy - halfY);
      expect(-b.min.z, d.id).toBeLessThanOrEqual(cy + halfY);
    }
  });

  it('yield a piece for every restyled kind present', () => {
    for (const kind of RESTYLED_KINDS) {
      const obstacles = resolved.obstacles.filter((o) => o.kind === kind);
      if (obstacles.length === 0) continue;
      const baseline = yardProps({ ...resolved, obstacles: [], props: [] }).length;
      expect(yardProps({ ...resolved, obstacles, props: [] }).length, kind).toBeGreaterThan(
        baseline,
      );
    }
  });
});

describe.each(cases)('$name drawing order', ({ resolved }) => {
  it('numbers parked bodies in resolved obstacle order, props and exercise blocks alike', () => {
    const at = (x: number, y: number): string => `${x},${y}`;
    const parked = resolved.obstacles.filter((o) => o.kind === 'parked');
    const drawn = new Set(parked.map(({ obb }) => at(obb.cx, obb.cy)));
    const pieces = yardProps(resolved)
      .map((p) => at(p.x, p.y))
      .filter((k) => drawn.has(k));
    expect(pieces).toEqual(parked.map(({ obb }) => at(obb.cx, obb.cy)));
  });
});

describe('corner hoops', () => {
  it('stand within thin relief of the hall block', () => {
    const hall = { minX: 10, minY: 52, maxX: 74, maxY: 68 };
    const pieces = cornerHoops(hall);
    expect(pieces).toHaveLength(4);
    for (const { geometry } of pieces) {
      const b = new Box3().setFromObject(new Mesh(geometry));
      expect(hall.minX - b.min.x).toBeLessThanOrEqual(MAX_RELIEF);
      expect(b.max.x - hall.maxX).toBeLessThanOrEqual(MAX_RELIEF);
      expect(-b.max.z - (hall.minY - MAX_RELIEF)).toBeGreaterThanOrEqual(0);
      expect(-b.min.z - (hall.maxY + MAX_RELIEF)).toBeLessThanOrEqual(0);
    }
  });
});

const wallBox = (minX: number, minY: number, maxX: number, maxY: number): Collider => ({
  kind: 'hall',
  obb: {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    halfLength: (maxX - minX) / 2,
    halfWidth: (maxY - minY) / 2,
    heading: 0,
  },
  height: 8,
});

/** Four walls around a courtyard. */
const hallProp = (id: string, x0: number): Prop => ({
  id,
  asset: 'hall',
  colliders: [
    wallBox(x0, 0, x0 + 1, 10),
    wallBox(x0 + 9, 0, x0 + 10, 10),
    wallBox(x0 + 1, 0, x0 + 9, 1),
    wallBox(x0 + 1, 9, x0 + 9, 10),
  ],
});

const withProps = (props: readonly Prop[]): ResolvedLayout => {
  const { resolved } = cases[0] ?? { resolved: undefined };
  if (resolved === undefined) throw new Error('no layout');
  return {
    ...resolved,
    obstacles: props.flatMap((p) => p.colliders.map((c, i) => ({ id: `${p.id}/${i}`, ...c }))),
    props,
    markings: [],
  };
};

describe('hall props', () => {
  it('are detailed one by one, with no gate across the gap between two halls', () => {
    const a = hallProp('hall-1', 0);
    const b = hallProp('hall-2', 17); // walls 9 m apart: a merged derivation would open a gate
    const plot = yardProps(withProps([])).length;
    const own = (prop: Prop): number => yardProps(withProps([prop])).length - plot;
    expect(own(a)).toBeGreaterThan(0);
    expect(yardProps(withProps([a, b])).length - plot).toBe(own(a) + own(b));
  });
});

describe('lamp fixtures', () => {
  const lampAt = (fixture: Fixture): Prop => ({
    id: 'lamp-1',
    asset: 'lamp',
    colliders: [
      {
        kind: 'lamp',
        obb: { cx: 0, cy: 0, halfLength: 0.15, halfWidth: 0.15, heading: 0 },
        height: 8,
      },
    ],
    fixture,
  });
  const box = (fixture: Fixture): Box3 => {
    const pieces = yardProps(withProps([lampAt(fixture)]));
    const [piece] = pieces;
    if (piece === undefined) throw new Error('no piece');
    return new Box3().setFromObject(new Mesh(piece.geometry));
  };
  const vertices = (fixture: Fixture): number =>
    yardProps(withProps([lampAt(fixture)]))[0]?.geometry.getAttribute('position').count ?? 0;

  it('carry floodlights only on a flood fixture', () => {
    const aim = { x: 10, y: 0 };
    expect(vertices({ kind: 'flood', aim })).toBeGreaterThan(vertices({ kind: 'street', aim }));
  });

  it.each(['flood', 'street'] as const)('face the aim of a %s fixture', (kind) => {
    const east = box({ kind, aim: { x: 10, y: 0 } });
    const west = box({ kind, aim: { x: -10, y: 0 } });
    expect(east.max.x).toBeGreaterThan(0.3);
    expect(east.min.x).toBeGreaterThan(-0.3);
    expect(west.min.x).toBeLessThan(-0.3);
    expect(west.max.x).toBeLessThan(0.3);
  });
});
