import type { Rect2, ResolvedLayout } from '../contracts/layout';
import { CAMERA_FAR } from './seams';

export type RoofKind = 'flat' | 'shed' | 'gable' | 'sawtooth';
export type BuildingKind =
  'office' | 'hall' | 'warehouse' | 'chimney' | 'poplar' | 'pylon' | 'crane';

/** A skyline building in the sim plane: `length` runs along `heading`, `depth` across it. */
export type Building = {
  readonly kind: BuildingKind;
  readonly x: number;
  readonly y: number;
  readonly heading: number;
  readonly length: number;
  readonly depth: number;
  readonly height: number;
  readonly roof: RoofKind;
  readonly skin: number; // facade scheme and colour variant, picked per building
  readonly seed: number;
  /** Share of haze mixed in, the same over the whole building. */
  readonly haze: number;
};

/** Deterministic xorshift in [0, 1): the same skyline in every session. */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

/** Footprint margin kept clear around the layout bounds. */
export const CLEARANCE = 12;
/** Stays well inside the cameras' far plane from anywhere in the bounds. */
export const REACH = CAMERA_FAR - 20;
const TAU = Math.PI * 2;
const NEAR_RING = { lo: 150, hi: 175, haze: 0.22 };
const FAR_RING = { lo: 205, hi: 225, haze: 0.5 };
const HEADING_JITTER = 0.2;
/** A crane's boom reaches this many spans beyond its centre. */
export const BOOM_REACH = 1.4;

/** Pattern repeated around each ring: mostly halls and offices, with the odd landmark. */
const KINDS: readonly BuildingKind[] = [
  'hall',
  'office',
  'warehouse',
  'poplar',
  'hall',
  'crane',
  'office',
  'hall',
  'pylon',
  'warehouse',
  'chimney',
  'poplar',
  'hall',
  'office',
];

const ROOFS: Record<'hall' | 'warehouse', readonly RoofKind[]> = {
  hall: ['gable', 'sawtooth', 'gable', 'shed'],
  warehouse: ['flat', 'shed', 'flat'],
};

type Size = { length: number; depth: number; height: number; roof: RoofKind };

function sizeOf(kind: BuildingKind, far: boolean, next: () => number): Size {
  const pick = (lo: number, hi: number): number => lo + (hi - lo) * next();
  const roofOf = (kinds: readonly RoofKind[]): RoofKind =>
    kinds[Math.floor(next() * kinds.length)] ?? 'flat';
  const reach = far ? 0.8 : 1;
  switch (kind) {
    case 'hall':
      return {
        length: pick(40, 70) * reach,
        depth: pick(24, 38) * reach,
        height: pick(8, 12),
        roof: roofOf(ROOFS.hall),
      };
    case 'warehouse':
      return {
        length: pick(35, 60) * reach,
        depth: pick(22, 34) * reach,
        height: pick(6, 9),
        roof: roofOf(ROOFS.warehouse),
      };
    case 'office':
      return {
        length: pick(25, 50),
        depth: pick(15, 22),
        height: pick(12, 30),
        roof: 'flat',
      };
    case 'chimney':
      return { length: pick(5, 7), depth: pick(5, 7), height: pick(55, 85), roof: 'flat' };
    case 'poplar':
      return { length: pick(6, 9), depth: pick(6, 9), height: pick(18, 26), roof: 'flat' };
    case 'pylon':
      return { length: pick(8, 11), depth: pick(8, 11), height: pick(40, 55), roof: 'flat' };
    case 'crane':
      return { length: pick(24, 32), depth: 12, height: pick(28, 38), roof: 'flat' };
  }
}

/** Radius of the circle around a building's centre that holds its whole footprint, boom included. */
export function footprintRadius(b: Pick<Building, 'kind' | 'length' | 'depth'>): number {
  if (b.kind === 'crane') return Math.hypot(b.length * BOOM_REACH + BOOM_REACH, b.depth / 2 + 2);
  return Math.hypot(b.length, b.depth) / 2;
}

function outside(bounds: Rect2, x: number, y: number, radius: number): boolean {
  const dx = Math.max(bounds.minX - x, 0, x - bounds.maxX);
  const dy = Math.max(bounds.minY - y, 0, y - bounds.maxY);
  return Math.hypot(dx, dy) > radius + CLEARANCE;
}

/** Two staggered rings of solid buildings around the layout, all outside its bounds. */
export function skylineBuildings(bounds: Rect2, seed = 1): readonly Building[] {
  const next = rng(seed);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const out: Building[] = [];
  for (const far of [true, false]) {
    const ring = far ? FAR_RING : NEAR_RING;
    const slots: { kind: BuildingKind; size: Size; radius: number; slot: number }[] = [];
    let used = 0;
    let i = Math.floor(next() * KINDS.length);
    for (;;) {
      const kind = KINDS[i % KINDS.length] ?? 'hall';
      i += 1;
      const size = sizeOf(kind, far, next);
      const radius = ring.lo + (ring.hi - ring.lo) * next();
      const slot = size.length + 8 + next() * 30;
      if (used + slot > TAU * ring.lo) break;
      used += slot;
      slots.push({ kind, size, radius, slot });
    }
    // The leftover arc becomes extra gap: spacing is scaled up to close the ring.
    const scale = (TAU * ring.lo) / used;
    let azimuth = next() * 0.3;
    for (const { kind, size, radius, slot } of slots) {
      const arc = slot * scale;
      azimuth += arc / 2 / ring.lo;
      const building = {
        kind,
        ...size,
        heading: azimuth + Math.PI / 2 + (next() - 0.5) * 2 * HEADING_JITTER,
        skin: Math.floor(next() * 6),
        seed: Math.floor(next() * 0x7fffffff) + 1,
        haze: ring.haze,
      };
      const fp = footprintRadius(building);
      let r = radius;
      const at = (d: number): [number, number] => [
        cx + Math.cos(azimuth) * d,
        cy + Math.sin(azimuth) * d,
      ];
      while (!outside(bounds, ...at(r), fp)) r += 5;
      const [x, y] = at(r);
      out.push({ ...building, x, y });
      azimuth += arc / 2 / ring.lo;
    }
  }
  return out;
}

/** Rows of the belt, outwards from the bounds: the first `CLEARANCE` out, then this far apart. */
const BELT_ROW_PITCH = 24;
/** Deepest belt building: long, shallow sheds fit between the bounds and the near ring. */
const BELT_DEPTH = 18;
const BELT_ROWS = 5;
const BELT_HAZE = 0.12;
/** Least gap between two buildings' footprint circles, belt or ring. */
const BELT_GAP = 3;
/** Keeps a surface that leaves the bounds this clear on each side. */
const CORRIDOR_MARGIN = 4;
const POPLAR_PITCH = 12;
/** Least gap between two slots along a row, and the step past a slot nothing fits. */
const BELT_STEP = 5;
/** The neighbouring estate: halls and sheds, the odd office, rows of poplars. */
const BELT_KINDS: readonly (BuildingKind | 'trees')[] = [
  'hall',
  'warehouse',
  'trees',
  'hall',
  'office',
  'warehouse',
  'hall',
  'trees',
];
/** Splits the belt's stream from the rings', so the rings stay as they are. */
const BELT_STREAM = 0x2c1b3c6d;

/** The surfaces that run out of the bounds, as strips out to the far plane the belt keeps clear. */
function corridors({ bounds, surfaces }: Pick<ResolvedLayout, 'bounds' | 'surfaces'>): Footprint[] {
  const out: Rect2[] = [];
  const far = CAMERA_FAR;
  const m = CORRIDOR_MARGIN;
  for (const { rect } of surfaces) {
    const across = { minY: rect.minY - m, maxY: rect.maxY + m };
    const along = { minX: rect.minX - m, maxX: rect.maxX + m };
    if (rect.minX <= bounds.minX)
      out.push({ minX: bounds.minX - far, maxX: bounds.minX, ...across });
    if (rect.maxX >= bounds.maxX)
      out.push({ minX: bounds.maxX, maxX: bounds.maxX + far, ...across });
    if (rect.minY <= bounds.minY)
      out.push({ minY: bounds.minY - far, maxY: bounds.minY, ...along });
    if (rect.maxY >= bounds.maxY)
      out.push({ minY: bounds.maxY, maxY: bounds.maxY + far, ...along });
  }
  return out.map((r) => ({
    x: (r.minX + r.maxX) / 2,
    y: (r.minY + r.maxY) / 2,
    heading: 0,
    length: r.maxX - r.minX,
    depth: r.maxY - r.minY,
  }));
}

const distanceTo = (r: Rect2, x: number, y: number): number =>
  Math.hypot(Math.max(r.minX - x, 0, x - r.maxX), Math.max(r.minY - y, 0, y - r.maxY));

type Footprint = Pick<Building, 'x' | 'y' | 'heading' | 'length' | 'depth'>;

function corners({ x, y, heading, length, depth }: Footprint): [number, number][] {
  const [c, s] = [Math.cos(heading), Math.sin(heading)];
  return [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ].map(([a = 0, b = 0]) => [
    x + (a * length * c - b * depth * s) / 2,
    y + (a * length * s + b * depth * c) / 2,
  ]);
}

/** Whether two footprints, each grown by `gap` / 2, overlap: separating axes. */
function overlap(a: Footprint, b: Footprint, gap: number): boolean {
  const ca = corners(a);
  const cb = corners(b);
  for (const heading of [a.heading, a.heading + Math.PI / 2, b.heading, b.heading + Math.PI / 2]) {
    const [ux, uy] = [Math.cos(heading), Math.sin(heading)];
    const project = (cs: [number, number][]): [number, number] => {
      const d = cs.map(([px, py]) => px * ux + py * uy);
      return [Math.min(...d), Math.max(...d)];
    };
    const [a0, a1] = project(ca);
    const [b0, b1] = project(cb);
    if (a1 + gap <= b0 || b1 + gap <= a0) return false;
  }
  return true;
}

/**
 * Rows of low buildings and poplars around the layout bounds, out to the near ring, so the ground
 * between the yard and the skyline is not bare from above. Clear of `rings`, of the surfaces that
 * leave the bounds and of each other.
 */
export function perimeterBuildings(
  layout: Pick<ResolvedLayout, 'bounds' | 'surfaces'>,
  rings: readonly Building[],
  seed = 1,
): readonly Building[] {
  const { bounds } = layout;
  const next = rng(seed ^ BELT_STREAM);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const keepClear = corridors(layout);
  const placed: Building[] = [];
  const fits = (b: Building): boolean => {
    const fp = footprintRadius(b);
    const cs = corners(b);
    return (
      cs.every(([x, y]) => distanceTo(bounds, x, y) >= CLEARANCE) &&
      Math.hypot(b.x - cx, b.y - cy) + fp <= NEAR_RING.hi &&
      keepClear.every((r) => !overlap(r, b, 0)) &&
      rings.every((o) =>
        o.kind === 'crane'
          ? Math.hypot(o.x - b.x, o.y - b.y) >= fp + footprintRadius(o) + BELT_GAP
          : !overlap(o, b, BELT_GAP),
      ) &&
      placed.every((o) => !overlap(o, b, BELT_GAP))
    );
  };
  // Each side runs counter-clockwise from its corner; its outward normal is its heading turned right.
  const sides = [
    { x: bounds.minX, y: bounds.minY, heading: 0, span: bounds.maxX - bounds.minX },
    { x: bounds.maxX, y: bounds.minY, heading: Math.PI / 2, span: bounds.maxY - bounds.minY },
    { x: bounds.maxX, y: bounds.maxY, heading: Math.PI, span: bounds.maxX - bounds.minX },
    { x: bounds.minX, y: bounds.maxY, heading: -Math.PI / 2, span: bounds.maxY - bounds.minY },
  ];
  /** The buildings of one slot, `along` the side from its corner and `offset` out; trees are a row of poplars. */
  const slot = (
    kind: BuildingKind | 'trees',
    side: (typeof sides)[number],
    along: number,
    offset: number,
  ): { buildings: Building[]; length: number } => {
    const [tx, ty] = [Math.cos(side.heading), Math.sin(side.heading)];
    const [nx, ny] = [ty, -tx];
    const trees = kind === 'trees';
    const count = trees ? 2 + Math.floor(next() * 4) : 1;
    const sized = sizeOf(trees ? 'poplar' : kind, false, next);
    const first = { ...sized, depth: Math.min(sized.depth, BELT_DEPTH) };
    const length = trees ? count * POPLAR_PITCH : first.length;
    const out = offset + first.depth / 2 + next() * 4;
    const buildings = Array.from({ length: count }, (_, i): Building => {
      const at = along + (trees ? (i + 0.5) * POPLAR_PITCH : length / 2);
      return {
        kind: trees ? 'poplar' : kind,
        ...(i === 0 ? first : sizeOf('poplar', false, next)),
        x: side.x + tx * at + nx * out,
        y: side.y + ty * at + ny * out,
        heading: side.heading + (trees ? 0 : (next() - 0.5) * 0.1),
        skin: Math.floor(next() * 6),
        seed: Math.floor(next() * 0x7fffffff) + 1,
        haze: BELT_HAZE,
      };
    });
    return { buildings, length };
  };
  let k = Math.floor(next() * BELT_KINDS.length);
  for (let row = 0; row < BELT_ROWS; row++) {
    const offset = CLEARANCE + 1 + row * BELT_ROW_PITCH;
    for (const side of sides) {
      // past the corners by the row's offset, so the rows of two sides meet
      let along = -offset + next() * 10;
      while (along < side.span + offset) {
        const kind = BELT_KINDS[k % BELT_KINDS.length] ?? 'hall';
        k += 1;
        // where the pattern's pick does not fit, a smaller shed or a row of trees may
        let used = 0;
        for (const tried of [kind, 'warehouse', 'trees'] as const) {
          const { buildings, length } = slot(tried, side, along, offset);
          const fitting = buildings.filter(fits);
          if (fitting.length * 2 > buildings.length) {
            placed.push(...fitting);
            used = length;
            break;
          }
        }
        along += used > 0 ? used + BELT_STEP + next() * BELT_STEP * 2 : BELT_STEP;
      }
    }
  }
  return placed;
}

/** Every building around `layout`: the two rings and the belt inside them. */
export function sceneryBuildings(
  layout: Pick<ResolvedLayout, 'bounds' | 'surfaces'>,
): readonly Building[] {
  const rings = skylineBuildings(layout.bounds);
  return [...rings, ...perimeterBuildings(layout, rings)];
}
