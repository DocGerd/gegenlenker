import { Box3, Mesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { exercises, layouts } from '../content/registry';
import { resolveLayout } from '../content/resolve-layout';
import {
  isKitDecor,
  type Collider,
  type Fixture,
  type Obstacle,
  type ObstacleKind,
  type Prop,
  type ResolvedLayout,
} from '../contracts/layout';
import { OVERLAY } from './yard-concrete';
import { EMIT_ATTRIBUTE, RETRO_ATTRIBUTE } from './tint';
import { yardLightSpec } from './yard-lights';
import { cornerHoops, decorPieces, type PropPiece, RESTYLED_KINDS, yardProps } from './yard-props';

const TOLERANCE = 0.05;
const MAX_RELIEF = 0.16; // thin relief only, as for seals and dock lights
const FLOAT32 = 1e-4;
const FILLS_FOOTPRINT: readonly ObstacleKind[] = ['parked', 'gatehouse', 'bollard', 'furniture'];
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
      const { cx, cy, heading } = obb;
      const [c, s] = [Math.abs(Math.cos(heading)), Math.abs(Math.sin(heading))];
      const halfX = c * obb.halfLength + s * obb.halfWidth;
      const halfY = s * obb.halfLength + c * obb.halfWidth;
      const covers = boxes.some(
        (b) =>
          Math.abs(b.min.x - (cx - halfX)) < TOLERANCE &&
          Math.abs(b.max.x - (cx + halfX)) < TOLERANCE &&
          Math.abs(b.min.z + (cy + halfY)) < TOLERANCE &&
          Math.abs(b.max.z + (cy - halfY)) < TOLERANCE,
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

  it('draw decor up to its height', () => {
    for (const d of resolved.decor.filter((d) => !isKitDecor(d))) {
      const [piece] = decorPieces([d]);
      const b = new Box3().setFromObject(new Mesh(piece?.geometry));
      expect(b.max.y, d.id).toBeCloseTo(d.height, 3);
    }
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

describe('kit props', () => {
  it('stand in until the kit draws them: one flagged piece set per prop, nothing else flagged', () => {
    for (const { resolved } of cases) {
      const kitProps = resolved.props.filter((p) => p.asset === 'kit');
      expect(kitProps.length).toBeGreaterThan(0);
      const flagged = yardProps(resolved).filter((p) => p.kitStandIn === true);
      const bare = yardProps({
        ...resolved,
        props: resolved.props.filter((p) => p.asset !== 'kit'),
      });
      expect(flagged.length).toBeGreaterThanOrEqual(kitProps.length);
      expect(bare.some((p) => p.kitStandIn === true)).toBe(false);
    }
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

describe('lamp heads', () => {
  const height = 9;
  const post = { x: 0, y: 0, height };
  const piece = (fixture: Fixture): PropPiece => {
    const pieces = yardProps(
      withProps([
        {
          id: 'lamp-1',
          asset: 'lamp',
          colliders: [
            {
              kind: 'lamp',
              obb: { cx: 0, cy: 0, halfLength: 0.15, halfWidth: 0.15, heading: 0 },
              height,
            },
          ],
          fixture,
        },
      ]),
    );
    const [first] = pieces;
    if (first === undefined) throw new Error('no piece');
    return first;
  };
  /** The box (three space) of the vertices that glow. */
  const lens = (p: PropPiece): Box3 => {
    const position = p.geometry.getAttribute('position');
    const emit = p.geometry.getAttribute(EMIT_ATTRIBUTE);
    const box = new Box3();
    for (let i = 0; i < position.count; i++) {
      if (emit.getX(i) + emit.getY(i) + emit.getZ(i) > 0)
        box.expandByPoint(new Vector3().fromBufferAttribute(position, i));
    }
    return box;
  };

  it.each(['flood', 'street'] as const)(
    'glow on the lens of a %s fixture and nowhere else',
    (kind) => {
      const p = piece({ kind, aim: { x: 10, y: 0 } });
      const box = lens(p);
      expect(box.isEmpty()).toBe(false);
      // the lens is a small part of the post's height, near its top
      expect(box.min.y).toBeGreaterThan(height - 1);
    },
  );

  it('hold a mast light just in front of its lens, at its height', () => {
    const fixture: Fixture = { kind: 'flood', aim: { x: 10, y: 0 } };
    const box = lens(piece(fixture));
    const at = yardLightSpec(post, fixture).position;
    // aimed along +x: three x is sim x, three y is sim z
    expect(at.x).toBeGreaterThan(box.max.x);
    expect(at.x - box.max.x).toBeLessThanOrEqual(0.05);
    expect(at.z).toBeGreaterThan(box.min.y);
    expect(at.z).toBeLessThan(box.max.y);
  });

  it('hold a street light just under its downward lens, across its middle', () => {
    const fixture: Fixture = { kind: 'street', aim: { x: 10, y: 0 } };
    const box = lens(piece(fixture));
    const at = yardLightSpec(post, fixture).position;
    expect(at.x).toBeGreaterThan(box.min.x);
    expect(at.x).toBeLessThan(box.max.x);
    expect(box.min.y - at.z).toBeGreaterThan(0);
    expect(box.min.y - at.z).toBeLessThanOrEqual(0.05);
  });

  it('carry an emit attribute on every piece of every layout, as one chunk merges them', () => {
    for (const { resolved } of cases) {
      for (const p of yardProps(resolved)) {
        expect(p.geometry.hasAttribute(EMIT_ATTRIBUTE)).toBe(true);
      }
    }
  });

  it('are the only vertices that glow', () => {
    for (const { resolved } of cases) {
      const lamps = resolved.props.filter((p) => p.fixture !== undefined).length;
      const glowing = yardProps(resolved).filter((p) => {
        const emit = p.geometry.getAttribute(EMIT_ATTRIBUTE);
        return emit.array.some((v) => v > 0);
      });
      expect(glowing).toHaveLength(lamps);
    }
  });
});

/** Vertices of `pieces` that carry retro-reflective sheeting. */
const sheeting = (pieces: readonly PropPiece[]): number =>
  pieces
    .flatMap((p) => Array.from(p.geometry.getAttribute(RETRO_ATTRIBUTE).array))
    .reduce((sum, v) => sum + v, 0);

/** What `obstacle` adds to a layout's drawing, so the yard around it cannot matter. */
const bare = new Map<ResolvedLayout, number>();
const sheetingOf = (layout: ResolvedLayout, obstacle: Obstacle): number => {
  const yard = bare.get(layout) ?? sheeting(yardProps({ ...layout, obstacles: [], props: [] }));
  bare.set(layout, yard);
  return sheeting(yardProps({ ...layout, obstacles: [obstacle], props: [] })) - yard;
};

describe('retro sheeting', () => {
  const [base] = cases;
  if (base === undefined) throw new Error('no layout');
  const REFLECTIVE: readonly ObstacleKind[] = ['cone', 'barrier'];

  it('puts the attribute on every piece, so merged chunks stay merged', () => {
    for (const { resolved } of cases) {
      for (const piece of yardProps(resolved)) {
        expect(piece.geometry.hasAttribute(RETRO_ATTRIBUTE)).toBe(true);
      }
    }
  });

  it('shines only on reflective kinds, and on a semitrailer, never on the rest', () => {
    for (const kind of RESTYLED_KINDS) {
      const obstacle = {
        id: `synthetic-${kind}`,
        kind,
        obb: { cx: 20, cy: 20, halfLength: 2, halfWidth: 0.5, heading: 0 },
        height: 1,
      };
      const shines = sheetingOf(base.resolved, obstacle) > 0;
      expect(shines, kind).toBe(REFLECTIVE.includes(kind));
    }
    const semi = {
      id: 'synthetic-semitrailer',
      kind: 'parked',
      obb: { cx: 20, cy: 20, halfLength: 7, halfWidth: 1.3, heading: 0 },
      height: 4,
    } satisfies Obstacle;
    expect(sheetingOf(base.resolved, semi)).toBeGreaterThan(0);
  });

  it('keeps decor and loose goods dark', () => {
    for (const { resolved } of cases) {
      const pieces = decorPieces(resolved.decor);
      expect(sheeting(pieces)).toBe(0);
    }
  });

  describe.each(cases)('$name', ({ resolved }) => {
    it('comes from the obstacle alone: the same in the yard of every layout and exercise', () => {
      // one of each kind and size: the rest draw alike
      const sizes = new Map(
        resolved.obstacles
          .filter((o) => RESTYLED_KINDS.has(o.kind))
          .map((o) => [`${o.kind} ${o.obb.halfLength} ${o.obb.halfWidth} ${o.height}`, o]),
      );
      const own = [...sizes.values()];
      expect(own.length).toBeGreaterThan(0);
      for (const o of own) {
        expect(sheetingOf(resolved, o), o.id).toBe(sheetingOf(base.resolved, o));
      }
    });
  });
});
