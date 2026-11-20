import { type BufferGeometry, Float32BufferAttribute } from 'three';
import {
  abs,
  attribute,
  float,
  floor,
  fract,
  min,
  mix,
  positionWorld,
  smoothstep,
  vec3,
} from 'three/tsl';
import { MeshLambertNodeMaterial, type Node } from 'three/webgpu';
import type { Marking, MarkingKind } from '../contracts/layout';
import { Chunks } from './ground-geometry';

/*
 * Worn paint for the High perspective markings. The wear is a function of world position and of the
 * distance to the paint's own edge, so every bay wears alike and no stroke loses its outline. One
 * generic formula (`wear`) runs on numbers for the tests and on shader nodes for the material.
 */

/** Names the worn marking in its shader, so a compile error can be traced to it. */
export const MARKING_WEAR_MARKER = 'markingWear';

/** Per vertex of a marking quad: (along, across) metres from its centre, then its half length and half width. */
export const MARK_BOX = 'markBox';

/** The most paint area the wear may take of any one wearing stroke (mean wear over it). */
export const WEAR_CAP = 0.35;

/** Symbols that carry meaning in their shape: never worn. */
export const SYMBOL_KINDS: ReadonlySet<MarkingKind> = new Set(['arrow', 'dock-number']);

const EDGE_KEEP = 0.025; // metres of every edge that never wears
const EDGE_KEEP_SHARE = 0.35; // of the half width, so a thin line keeps a core to wear
const EDGE_FEATHER = 0.02;
const COARSE_CELL = 0.9;
const FINE_CELL = 0.16;
const FINE_SHARE = 0.4;
const WEAR_FROM = 0.5;
const WEAR_SOFT = 0.14;
const DIRT = 0.55; // paint tone where it is fully worn
const HOLE_FROM = 0.55; // wear where paint starts to go
const HOLE_TO = 0.8;
const HASH_SCALE = 0.1031;
const HASH_OFFSET = 33.33;

/** The arithmetic the wear formula needs, over plain numbers or shader nodes. */
type Arith<T> = {
  c(value: number): T;
  add(a: T, b: T): T;
  sub(a: T, b: T): T;
  mul(a: T, b: T): T;
  abs(a: T): T;
  floor(a: T): T;
  fract(a: T): T;
  min(a: T, b: T): T;
  mix(a: T, b: T, t: T): T;
  smoothstep(from: T, to: T, x: T): T;
};

const numbers: Arith<number> = {
  c: (value) => value,
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  mul: (a, b) => a * b,
  abs: Math.abs,
  floor: Math.floor,
  fract: (a) => a - Math.floor(a),
  min: Math.min,
  mix: (a, b, t) => a + (b - a) * t,
  smoothstep: (from, to, x) => {
    const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
    return t * t * (3 - 2 * t);
  },
};

type FloatNode = Node<'float'>;
const nodes: Arith<FloatNode> = {
  c: (value) => float(value),
  add: (a, b) => a.add(b),
  sub: (a, b) => a.sub(b),
  mul: (a, b) => a.mul(b),
  abs: (a) => abs(a),
  floor: (a) => floor(a),
  fract: (a) => fract(a),
  min: (a, b) => min(a, b),
  mix: (a, b, t) => mix(a, b, t),
  smoothstep: (from, to, x) => smoothstep(from, to, x),
};

/** Dave Hoskins' hash, free of `sin` so large coordinates stay well-behaved on a GPU. */
function hash<T>(o: Arith<T>, x: T, y: T): T {
  const a = o.fract(o.mul(x, o.c(HASH_SCALE)));
  const b = o.fract(o.mul(y, o.c(HASH_SCALE)));
  const k = o.c(HASH_OFFSET);
  const d = o.add(o.add(o.mul(a, o.add(b, k)), o.mul(b, o.add(a, k))), o.mul(a, o.add(a, k)));
  const [pa, pb] = [o.add(a, d), o.add(b, d)];
  return o.fract(o.mul(o.add(pa, pb), pa));
}

function valueNoise<T>(o: Arith<T>, x: T, y: T): T {
  const [ix, iy] = [o.floor(x), o.floor(y)];
  const [fx, fy] = [o.sub(x, ix), o.sub(y, iy)];
  const ease = (f: T): T => o.mul(o.mul(f, f), o.sub(o.c(3), o.mul(o.c(2), f)));
  const [ux, uy] = [ease(fx), ease(fy)];
  const one = o.c(1);
  const row = (j: T): T =>
    o.mix(hash(o, ix, o.add(iy, j)), hash(o, o.add(ix, one), o.add(iy, j)), ux);
  return o.mix(row(o.c(0)), row(one), uy);
}

/** How far the paint's edge is kept clear of wear, in metres, on a stroke of half width `halfWidth`. */
export const edgeKeep = (halfWidth: number): number =>
  Math.min(EDGE_KEEP, halfWidth * EDGE_KEEP_SHARE);

/**
 * Wear in 0..1 at world `(x, z)` for a point `along` and `across` metres from the centre of a
 * quad of half length `halfLength` and half width `halfWidth`. It is zero within `edgeKeep` of
 * every edge, and everywhere on a quad of no extent.
 */
function wear<T>(o: Arith<T>, x: T, z: T, along: T, across: T, halfLength: T, halfWidth: T): T {
  const scaled = (v: T, cell: number): T => o.mul(v, o.c(1 / cell));
  const coarse = valueNoise(o, scaled(x, COARSE_CELL), scaled(z, COARSE_CELL));
  const fine = valueNoise(o, scaled(x, FINE_CELL), scaled(z, FINE_CELL));
  const field = o.add(o.mul(coarse, o.c(1 - FINE_SHARE)), o.mul(fine, o.c(FINE_SHARE)));
  const edge = o.min(o.sub(halfLength, o.abs(along)), o.sub(halfWidth, o.abs(across)));
  const keep = o.min(o.c(EDGE_KEEP), o.mul(halfWidth, o.c(EDGE_KEEP_SHARE)));
  return o.mul(
    o.smoothstep(o.c(WEAR_FROM), o.c(WEAR_FROM + WEAR_SOFT), field),
    o.smoothstep(keep, o.add(keep, o.c(EDGE_FEATHER)), edge),
  );
}

/** `wear` on numbers: what the shader computes, up to float precision. */
export const wearAt = (
  x: number,
  z: number,
  along: number,
  across: number,
  halfLength: number,
  halfWidth: number,
): number => wear(numbers, x, z, along, across, halfLength, halfWidth);

/**
 * Gives a marking quad its `MARK_BOX` attribute, read from its corners (`rectGeometry`'s plane
 * order: along first, across second). A quad that is not `worn` gets no extent, so it never wears.
 */
export function addMarkBox(geometry: BufferGeometry, worn: boolean): void {
  const position = geometry.getAttribute('position');
  if (position.count !== 4) throw new Error('a marking piece is one quad');
  const at = (i: number): [number, number, number] => [
    position.getX(i),
    position.getY(i),
    position.getZ(i),
  ];
  const [x0, y0, z0] = at(0);
  const [x1, y1, z1] = at(1);
  const [x2, y2, z2] = at(2);
  const along = [x1 - x0, y1 - y0, z1 - z0] as const;
  const across = [x2 - x0, y2 - y0, z2 - z0] as const;
  const length = Math.hypot(...along);
  const width = Math.hypot(...across);
  if (length === 0 || width === 0) throw new Error('a marking piece has an extent');
  const unit = (v: readonly [number, number, number], size: number): number[] =>
    v.map((c) => c / size);
  const [ax = 0, ay = 0, az = 0] = unit(along, length);
  const [bx = 0, by = 0, bz = 0] = unit(across, width);
  const corners = [0, 1, 2, 3].map(at);
  const centre = [0, 1, 2].map((k) => corners.reduce((sum, c) => sum + (c[k] ?? 0) / 4, 0));
  const box = new Float32Array(16);
  corners.forEach(([x, y, z], k) => {
    const [dx, dy, dz] = [x - (centre[0] ?? 0), y - (centre[1] ?? 0), z - (centre[2] ?? 0)];
    box.set(
      [
        dx * ax + dy * ay + dz * az,
        dx * bx + dy * by + dz * bz,
        worn ? length / 2 : 0,
        worn ? width / 2 : 0,
      ],
      k * 4,
    );
  });
  geometry.setAttribute(MARK_BOX, new Float32BufferAttribute(box, 4));
}

/** The marking chunks, every piece carrying its `MARK_BOX`; set `worn` before adding a marking. */
export class MarkingChunks extends Chunks {
  worn = true;

  override add(x: number, y: number, geometry: BufferGeometry): void {
    addMarkBox(geometry, this.worn);
    super.add(x, y, geometry);
  }
}

type Rect = {
  readonly cx: number;
  readonly cy: number;
  readonly ux: number;
  readonly uy: number;
  readonly hl: number;
  readonly hw: number;
};

const rectOf = (m: Marking): Rect => {
  const dx = m.to.x - m.from.x;
  const dy = m.to.y - m.from.y;
  const length = Math.hypot(dx, dy);
  return {
    cx: (m.from.x + m.to.x) / 2,
    cy: (m.from.y + m.to.y) / 2,
    ux: dx / length,
    uy: dy / length,
    hl: length / 2,
    hw: m.width / 2,
  };
};

/** Separating-axis test; touching rectangles do not overlap. */
function overlaps(a: Rect, b: Rect): boolean {
  const gap = 1e-6;
  const reach = (r: Rect, axisX: number, axisY: number): number =>
    r.hl * Math.abs(axisX * r.ux + axisY * r.uy) + r.hw * Math.abs(-axisX * r.uy + axisY * r.ux);
  for (const r of [a, b]) {
    for (const [ax, ay] of [
      [r.ux, r.uy],
      [-r.uy, r.ux],
    ] as const) {
      const centres = Math.abs((b.cx - a.cx) * ax + (b.cy - a.cy) * ay);
      if (centres >= reach(a, ax, ay) + reach(b, ax, ay) - gap) return false;
    }
  }
  return true;
}

/**
 * Which markings may wear: not the symbols (digits, arrows), and not a stroke that crosses another
 * one, whose coplanar overlap would otherwise show two tones. A dashed line counts as its whole run.
 */
export function wearableMarkings(markings: readonly Marking[]): boolean[] {
  const rects = markings.map((m) =>
    Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y) > 0 ? rectOf(m) : null,
  );
  return markings.map((m, i) => {
    const rect = rects[i];
    if (SYMBOL_KINDS.has(m.kind) || rect === null || rect === undefined) return false;
    return !rects.some((other, j) => j !== i && other !== null && overlaps(rect, other));
  });
}

/**
 * The marking copies' material on the High PBR ground: the lit flat look with paint worn away by
 * `wear`. Worn paint dims and, where it goes, shows the ground through a hole (alpha to coverage),
 * so the draw count is the same as the unworn markings'.
 */
export function createWornMarkingMaterial(): MeshLambertNodeMaterial {
  const material = new MeshLambertNodeMaterial({
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const box = attribute(MARK_BOX, 'vec4');
  const worn = wear(nodes, positionWorld.x, positionWorld.z, box.x, box.y, box.z, box.w).toVar(
    MARKING_WEAR_MARKER,
  );
  material.colorNode = vec3(mix(float(1), float(DIRT), smoothstep(0.1, HOLE_FROM, worn)));
  material.opacityNode = float(1).sub(smoothstep(HOLE_FROM, HOLE_TO, worn));
  material.alphaTest = 0.5;
  material.alphaToCoverage = true;
  return material;
}
