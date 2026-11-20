import { type BufferGeometry, Float32BufferAttribute } from 'three';
import {
  abs,
  attribute,
  dot,
  float,
  floor,
  fract,
  min,
  mix,
  positionWorld,
  smoothstep,
  vec2,
  vec3,
} from 'three/tsl';
import { MeshLambertNodeMaterial, type Node } from 'three/webgpu';

/*
 * Worn paint for the High perspective markings. The wear is a function of world position and of the
 * distance to the paint's own edge, so every bay wears alike and no stroke loses its outline. The
 * shader and the TypeScript reference below share formulas, not bits: the tests pin the statistics.
 */

/** Names the worn marking in its shader, so a compile error can be traced to it. */
export const MARKING_WEAR_MARKER = 'markingWear';

/** Per vertex of a marking quad: (along, across) metres from its centre, then its half length and half width. */
export const MARK_BOX = 'markBox';

/** The most paint area the wear may take (mean wear over a marking). */
export const WEAR_CAP = 0.35;

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

type Vec2Node = Node<'vec2'>;
type FloatNode = Node<'float'>;

const fractPart = (v: number): number => v - Math.floor(v);
const smooth = (from: number, to: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/** Dave Hoskins' hash, free of `sin` so large coordinates stay well-behaved on a GPU. */
function hashAt(x: number, y: number): number {
  let a = fractPart(x * 0.1031);
  let b = fractPart(y * 0.1031);
  let c = fractPart(x * 0.1031);
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d;
  b += d;
  c += d;
  return fractPart((a + b) * c);
}

function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const row = (j: number): number => {
    const left = hashAt(ix, iy + j);
    return left + (hashAt(ix + 1, iy + j) - left) * ux;
  };
  return row(0) + (row(1) - row(0)) * uy;
}

/** How far the paint's edge is kept clear of wear, in metres. */
export const edgeKeep = (halfWidth: number): number =>
  Math.min(EDGE_KEEP, halfWidth * EDGE_KEEP_SHARE);

/**
 * Wear in 0..1 at world `(x, z)`, for paint `edge` metres from its nearest edge on a stroke of
 * half width `halfWidth`. It is zero within `edgeKeep` of every edge.
 */
export function wearAt(x: number, z: number, edge: number, halfWidth: number): number {
  const field =
    valueNoise(x / COARSE_CELL, z / COARSE_CELL) * (1 - FINE_SHARE) +
    valueNoise(x / FINE_CELL, z / FINE_CELL) * FINE_SHARE;
  const keep = edgeKeep(halfWidth);
  return smooth(WEAR_FROM, WEAR_FROM + WEAR_SOFT, field) * smooth(keep, keep + EDGE_FEATHER, edge);
}

/**
 * Gives each four-vertex marking quad of `geometry` its `MARK_BOX` attribute, read from the quad's
 * corners (`rectGeometry`'s plane order: along first, across second). Returns false, leaving the
 * geometry untouched, when it is not made of such quads.
 */
export function addMarkBox(geometry: BufferGeometry): boolean {
  const position = geometry.getAttribute('position');
  if (position.count === 0 || position.count % 4 !== 0) return false;
  const box = new Float32Array(position.count * 4);
  const at = (i: number): [number, number, number] => [
    position.getX(i),
    position.getY(i),
    position.getZ(i),
  ];
  for (let q = 0; q < position.count; q += 4) {
    const [x0, y0, z0] = at(q);
    const [x1, y1, z1] = at(q + 1);
    const [x2, y2, z2] = at(q + 2);
    const along = [x1 - x0, y1 - y0, z1 - z0] as const;
    const across = [x2 - x0, y2 - y0, z2 - z0] as const;
    const length = Math.hypot(...along);
    const width = Math.hypot(...across);
    if (length === 0 || width === 0) return false;
    const unit = (v: readonly [number, number, number], size: number): number[] =>
      v.map((c) => c / size);
    const [ax = 0, ay = 0, az = 0] = unit(along, length);
    const [bx = 0, by = 0, bz = 0] = unit(across, width);
    const centre = [0, 1, 2, 3].reduce<[number, number, number]>(
      (sum, k) => {
        const [x, y, z] = at(q + k);
        return [sum[0] + x / 4, sum[1] + y / 4, sum[2] + z / 4];
      },
      [0, 0, 0],
    );
    for (let k = 0; k < 4; k++) {
      const [x, y, z] = at(q + k);
      const [dx, dy, dz] = [x - centre[0], y - centre[1], z - centre[2]];
      box.set(
        [dx * ax + dy * ay + dz * az, dx * bx + dy * by + dz * bz, length / 2, width / 2],
        (q + k) * 4,
      );
    }
  }
  geometry.setAttribute(MARK_BOX, new Float32BufferAttribute(box, 4));
  return true;
}

const hashNode = (cell: Vec2Node): FloatNode => {
  const p = fract(vec3(cell.x, cell.y, cell.x).mul(0.1031));
  const shifted = p.add(dot(p, vec3(p.y, p.z, p.x).add(33.33)));
  return fract(shifted.x.add(shifted.y).mul(shifted.z));
};

const noiseNode = (p: Vec2Node): FloatNode => {
  const cell = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(float(3).sub(f.mul(2)));
  const corner = (dx: number, dy: number): FloatNode => hashNode(cell.add(vec2(dx, dy)));
  return mix(mix(corner(0, 0), corner(1, 0), u.x), mix(corner(0, 1), corner(1, 1), u.x), u.y);
};

/**
 * The marking copies' material on the High PBR ground: the lit flat look with paint worn away by
 * `wearAt`. Worn paint dims and, where it goes, shows the ground through a hole (alpha to coverage),
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
  const edge = min(box.z.sub(abs(box.x)), box.w.sub(abs(box.y)));
  const keep = min(float(EDGE_KEEP), box.w.mul(EDGE_KEEP_SHARE));
  const world = vec2(positionWorld.x, positionWorld.z);
  const field = noiseNode(world.div(COARSE_CELL))
    .mul(1 - FINE_SHARE)
    .add(noiseNode(world.div(FINE_CELL)).mul(FINE_SHARE));
  const wear = smoothstep(WEAR_FROM, WEAR_FROM + WEAR_SOFT, field)
    .mul(smoothstep(keep, keep.add(EDGE_FEATHER), edge))
    .toVar(MARKING_WEAR_MARKER);
  material.colorNode = vec3(mix(float(1), float(DIRT), smoothstep(0.1, HOLE_FROM, wear)));
  material.opacityNode = float(1).sub(smoothstep(HOLE_FROM, HOLE_TO, wear));
  material.alphaTest = 0.5;
  material.alphaToCoverage = true;
  return material;
}
