import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGFormat,
  UnsignedByteType,
} from 'three';
import type { Obb, Vec2 } from '../contracts/sim';
import type { Rect2, ResolvedLayout } from '../contracts/layout';

/*
 * The CPU-authored mask the PBR ground reads for contact occlusion (R) and yard decals (G): zero is
 * neutral in both. It depends on the layout only, never on the target, and every decal is placed by
 * a rule that treats all bays alike, so the ground never hints at where the run ends.
 */

/** Metres one texel covers, widened when the layout would not fit `MAX_SIZE`. */
export const MASK_TEXEL = 0.1;
export const MASK_MAX_SIZE = 2048;

/** Peak darkening of the indirect light beside a footprint, and how far the contact reaches. */
export const CONTACT_PEAK = 0.7;
const REACH = { base: 0.25, perMetre: 0.2, max: 0.8 };
/** Decor has no height of its own; its goods stand about this tall. */
const DECOR_HEIGHT = 2;

/** Share of albedo a full decal removes. Above `GLOSS_FROM` a decal is wet or metal: smoother. */
export const WEAR_DARKEN = 0.65;
export const GLOSS_FROM = 0.6;
export const GLOSS_ROUGHNESS = 0.35;

const CELL = { scuff: 10, manhole: 24, gully: 24 };
const SCUFF_ODDS = 0.5;
const MANHOLE_ODDS = 0.7;
const MANHOLE_RADIUS = 0.34;
const GULLY = { halfLength: 0.4, halfWidth: 0.18, kerbSetback: 0.3, slat: 0.1 };
const DRIPS_PER_PARKED = 4;

export type GroundMask = {
  /** Interleaved R (contact occlusion) and G (decal), `width * height` texels, row 0 at `origin.y`. */
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
  /** Metres per texel. */
  readonly texel: number;
  readonly origin: Vec2;
};

type Sampler = (x: number, y: number) => number;

const smooth = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** Deterministic value in [0, 1) from integers. */
function rand(...ints: readonly number[]): number {
  let h = 0x9e3779b9;
  for (const n of ints) {
    h = Math.imul(h ^ Math.trunc(n), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return (h >>> 0) / 4294967296;
}

const cm = (metres: number): number => Math.round(metres * 100);

/** Distance (m) from a point to the box, 0 inside. */
function distanceToObb(obb: Obb, x: number, y: number): number {
  const cos = Math.cos(obb.heading);
  const sin = Math.sin(obb.heading);
  const dx = x - obb.cx;
  const dy = y - obb.cy;
  const along = Math.abs(cos * dx + sin * dy) - obb.halfLength;
  const across = Math.abs(-sin * dx + cos * dy) - obb.halfWidth;
  return Math.hypot(Math.max(along, 0), Math.max(across, 0));
}

const obbBounds = (obb: Obb, margin: number): Rect2 => {
  const cos = Math.abs(Math.cos(obb.heading));
  const sin = Math.abs(Math.sin(obb.heading));
  const ex = cos * obb.halfLength + sin * obb.halfWidth + margin;
  const ey = sin * obb.halfLength + cos * obb.halfWidth + margin;
  return { minX: obb.cx - ex, minY: obb.cy - ey, maxX: obb.cx + ex, maxY: obb.cy + ey };
};

const inside = (rect: Rect2, x: number, y: number): boolean =>
  x >= rect.minX && x <= rect.maxX && y >= rect.minY && y <= rect.maxY;

/** Raises each texel of `channel` under `box` to `sample` at its centre, 0 to 1. */
type Paint = (channel: 0 | 1, box: Rect2, sample: Sampler) => void;

function painter(
  data: Uint8Array,
  width: number,
  height: number,
  texel: number,
  origin: Vec2,
): Paint {
  return (channel, box, sample) => {
    const i0 = Math.max(0, Math.floor((box.minX - origin.x) / texel));
    const i1 = Math.min(width - 1, Math.floor((box.maxX - origin.x) / texel));
    const j0 = Math.max(0, Math.floor((box.minY - origin.y) / texel));
    const j1 = Math.min(height - 1, Math.floor((box.maxY - origin.y) / texel));
    for (let j = j0; j <= j1; j++) {
      const y = origin.y + (j + 0.5) * texel;
      for (let i = i0; i <= i1; i++) {
        const value = Math.round(sample(origin.x + (i + 0.5) * texel, y) * 255);
        const at = (j * width + i) * 2 + channel;
        if (value > (data[at] ?? 0)) data[at] = value;
      }
    }
  };
}

export function groundMask(layout: ResolvedLayout): GroundMask {
  const { bounds } = layout;
  const texel = Math.max(
    MASK_TEXEL,
    (bounds.maxX - bounds.minX) / MASK_MAX_SIZE,
    (bounds.maxY - bounds.minY) / MASK_MAX_SIZE,
  );
  const width = Math.ceil((bounds.maxX - bounds.minX) / texel);
  const height = Math.ceil((bounds.maxY - bounds.minY) / texel);
  const origin = { x: bounds.minX, y: bounds.minY };
  const data = new Uint8Array(width * height * 2);
  const paint = painter(data, width, height, texel, origin);

  const contact = (obb: Obb, tall: number): void => {
    const reach = Math.min(REACH.max, REACH.base + REACH.perMetre * tall);
    paint(0, obbBounds(obb, reach), (x, y) => {
      const t = 1 - distanceToObb(obb, x, y) / reach;
      return t > 0 ? CONTACT_PEAK * t * t : 0;
    });
  };
  for (const o of layout.obstacles) contact(o.obb, o.height);
  for (const d of layout.decor) contact(d.footprint, DECOR_HEIGHT);

  const roads = layout.surfaces.filter((s) => s.kind !== 'pavement').map((s) => s.rect);
  const onRoad = (x: number, y: number): boolean => roads.some((rect) => inside(rect, x, y));
  const decal = (box: Rect2, sample: Sampler): void =>
    paint(1, box, (x, y) => (onRoad(x, y) ? sample(x, y) : 0));

  const disc = (x: number, y: number, radius: number, value: number): void =>
    decal({ minX: x - radius, minY: y - radius, maxX: x + radius, maxY: y + radius }, (px, py) =>
      Math.hypot(px - x, py - y) < radius
        ? value * (1 - smooth(radius * 0.4, radius, Math.hypot(px - x, py - y)))
        : 0,
    );

  /** A broken rubber streak: a tapered arc, `curvature` the turn (rad) per metre. */
  const scuff = (
    seed: readonly number[],
    from: Vec2,
    heading: number,
    curvature: number,
    length: number,
    strength: number,
  ): void => {
    const width = 0.35;
    const steps = Math.ceil(length / (width / 2));
    const ds = length / steps;
    let { x, y } = from;
    let angle = heading;
    for (let k = 0; k < steps; k++) {
      const taper = Math.pow(Math.sin((Math.PI * (k + 0.5)) / steps), 0.6);
      const broken = 0.6 + 0.4 * rand(...seed, k);
      disc(x, y, (width / 2) * (0.6 + 0.4 * taper), strength * taper * broken);
      angle += (curvature * ds) / 2;
      x += Math.cos(angle) * ds;
      y += Math.sin(angle) * ds;
      angle += (curvature * ds) / 2;
    }
  };

  const drip = (x: number, y: number, radius: number): void => {
    disc(x, y, radius * 2.2, 0.35);
    disc(x, y, radius, 0.9);
  };

  // every bay line alike: a scuff curving away from each end, seeded by the line itself
  for (const m of layout.markings) {
    if (m.kind !== 'bay') continue;
    const [a, b] = [m.from, m.to].sort((p, q) => p.x - q.x || p.y - q.y);
    if (a === undefined || b === undefined) continue;
    for (const [end, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const seed = [cm(end.x), cm(end.y), cm(other.x), cm(other.y)];
      const length = Math.hypot(end.x - other.x, end.y - other.y);
      if (length === 0) continue;
      const dx = (end.x - other.x) / length;
      const dy = (end.y - other.y) / length;
      const side = rand(...seed, 1) < 0.5 ? -1 : 1;
      const lateral = 0.5 + 0.5 * rand(...seed, 2);
      scuff(
        seed,
        { x: end.x + dx * 0.3 - dy * side * lateral, y: end.y + dy * 0.3 + dx * side * lateral },
        Math.atan2(dy, dx) - side * 0.35,
        -side * 0.08,
        2.5 + rand(...seed, 3) * 1.5,
        0.5,
      );
    }
  }

  // every parked trailer alike: oil drips around its footprint
  for (const prop of layout.props) {
    if (prop.asset !== 'parked') continue;
    for (const { obb } of prop.colliders) {
      const cos = Math.cos(obb.heading);
      const sin = Math.sin(obb.heading);
      for (let k = 0; k < DRIPS_PER_PARKED; k++) {
        const seed = [cm(obb.cx), cm(obb.cy), k];
        const u = (rand(...seed, 1) * 2 - 1) * (obb.halfLength + 0.8);
        const v = (rand(...seed, 2) * 2 - 1) * (obb.halfWidth + 0.3);
        drip(obb.cx + cos * u - sin * v, obb.cy + sin * u + cos * v, 0.1 + 0.1 * rand(...seed, 3));
      }
    }
  }

  // scuffs, manholes and gullies by world cell, so they never depend on the layout's content
  const cells = (size: number, visit: (i: number, j: number) => void): void => {
    for (let i = Math.floor(bounds.minX / size); i < Math.ceil(bounds.maxX / size); i++) {
      for (let j = Math.floor(bounds.minY / size); j < Math.ceil(bounds.maxY / size); j++) {
        visit(i, j);
      }
    }
  };
  cells(CELL.scuff, (i, j) => {
    if (rand(10, i, j) >= SCUFF_ODDS) return;
    const at = {
      x: (i + rand(11, i, j)) * CELL.scuff,
      y: (j + rand(12, i, j)) * CELL.scuff,
    };
    const turn = (rand(14, i, j) < 0.5 ? -1 : 1) * (0.05 + 0.1 * rand(15, i, j));
    scuff(
      [16, i, j],
      at,
      rand(13, i, j) * 2 * Math.PI,
      turn,
      3 + 2 * rand(17, i, j),
      0.35 + 0.15 * rand(18, i, j),
    );
  });
  cells(CELL.manhole, (i, j) => {
    if (rand(20, i, j) >= MANHOLE_ODDS) return;
    const x = (i + 0.15 + 0.7 * rand(21, i, j)) * CELL.manhole;
    const y = (j + 0.15 + 0.7 * rand(22, i, j)) * CELL.manhole;
    const r = MANHOLE_RADIUS;
    decal(
      { minX: x - r - 0.1, minY: y - r - 0.1, maxX: x + r + 0.1, maxY: y + r + 0.1 },
      (px, py) => {
        const d = Math.hypot(px - x, py - y);
        return d < r - 0.04 ? 0.8 : 0.45 * (1 - smooth(r - 0.04, r + 0.06, d));
      },
    );
  });
  const street = layout.surfaces.find((s) => s.kind === 'street')?.rect;
  if (street !== undefined) {
    const y = street.maxY - GULLY.kerbSetback;
    const { halfLength, halfWidth, slat } = GULLY;
    for (let x = street.minX + CELL.gully / 2; x < street.maxX; x += CELL.gully) {
      decal(
        { minX: x - halfLength, minY: y - halfWidth, maxX: x + halfLength, maxY: y + halfWidth },
        (px, py) =>
          Math.abs(px - x) < halfLength && Math.abs(py - y) < halfWidth
            ? Math.floor((px - x + halfLength) / slat) % 2 === 0
              ? 0.9
              : 0.55
            : 0,
      );
    }
  }

  return { data, width, height, texel, origin };
}

/** The mask as a texture: its data stays on the CPU, so a lost context uploads it again. */
export function groundMaskTexture(mask: GroundMask): DataTexture {
  const texture = new DataTexture(mask.data, mask.width, mask.height, RGFormat, UnsignedByteType);
  texture.wrapS = texture.wrapT = ClampToEdgeWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4; // three clamps this to what the GPU offers
  texture.needsUpdate = true;
  return texture;
}
