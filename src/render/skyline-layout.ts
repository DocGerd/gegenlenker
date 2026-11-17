import type { Rect2 } from '../contracts/layout';
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
