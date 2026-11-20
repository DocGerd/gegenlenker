import {
  BoxGeometry,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Mesh,
  PlaneGeometry,
  RingGeometry,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Tolerances } from '../contracts/exercise';
import type { Rect2, ResolvedLayout, SurfaceKind } from '../contracts/layout';
import type { ScenePalette } from '../contracts/render';
import { GROUND_SURFACES } from './ground-texture-spec';
import { tint } from './tint';

const VERGE_Y = 0;
const SURFACE_Y = 0.005;
const BAND_SEGMENTS = 48;
const CHUNK = 60; // spatial chunk edge: frustum culling works per chunk

/** Flat rectangle in the ground plane; x forward, y left (Three z = −y). */
export function rectGeometry(
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  up = 0,
): BufferGeometry {
  return new PlaneGeometry(x1 - x0, y1 - y0)
    .rotateX(-Math.PI / 2)
    .translate((x0 + x1) / 2, up, -(y0 + y1) / 2);
}

/** Outline of a `length` × `width` zone whose rear-end centre is the origin, strips centred on the edges. */
export function outlineGeometry(length: number, width: number, strip: number): BufferGeometry {
  const t = strip / 2;
  const hw = width / 2;
  return mergeGeometries([
    rectGeometry(-t, length + t, -hw - t, -hw + t),
    rectGeometry(-t, length + t, hw - t, hw + t),
    rectGeometry(-t, t, -hw + t, hw - t),
    rectGeometry(length - t, length + t, -hw + t, hw - t),
  ]);
}

/**
 * Tolerance band in a frame whose origin is the target's rear-end centre, x along its heading: a ring
 * of the position tolerance and two rays at the angle tolerance, the poses the scoring accepts.
 */
export function toleranceGeometry(
  tolerances: Tolerances,
  length: number,
  strip: number,
): BufferGeometry {
  const half = strip / 2;
  const { position, angle } = tolerances;
  const tilt = (angle * Math.PI) / 180;
  const ring = new RingGeometry(
    Math.max(0, position - half),
    position + half,
    BAND_SEGMENTS,
  ).rotateX(-Math.PI / 2);
  const ray = (sign: number): BufferGeometry =>
    rectGeometry(0, length, -half, half).rotateY(sign * tilt);
  return mergeGeometries([ring, ray(1), ray(-1)]);
}

export function boxGeometry(
  cx: number,
  cy: number,
  length: number,
  width: number,
  heading: number,
  y0: number,
  y1: number,
): BufferGeometry {
  return new BoxGeometry(length, y1 - y0, width).rotateY(heading).translate(cx, (y0 + y1) / 2, -cy);
}

export class Chunks {
  private readonly cells = new Map<number, BufferGeometry[]>();
  private readonly cols: number;
  private readonly rows: number;
  private readonly bounds: Rect2;

  constructor(bounds: Rect2) {
    this.bounds = bounds;
    this.cols = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / CHUNK));
    this.rows = Math.max(1, Math.ceil((bounds.maxY - bounds.minY) / CHUNK));
  }

  add(x: number, y: number, geometry: BufferGeometry): void {
    const col = Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.bounds.minX) / CHUNK)));
    const row = Math.min(this.rows - 1, Math.max(0, Math.floor((y - this.bounds.minY) / CHUNK)));
    const key = row * this.cols + col;
    const list = this.cells.get(key);
    if (list === undefined) this.cells.set(key, [geometry]);
    else list.push(geometry);
  }

  /** One mesh per occupied chunk; the source geometries are released. */
  meshes(material: Material, geometries: BufferGeometry[]): Mesh[] {
    const out: Mesh[] = [];
    for (const list of this.cells.values()) {
      const merged = mergeGeometries(list);
      list.forEach((g) => g.dispose());
      geometries.push(merged);
      out.push(new Mesh(merged, material));
    }
    return out;
  }
}

type GroundCell = {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  /** `undefined` is the verge. */
  readonly kind: SurfaceKind | undefined;
};

/** Non-overlapping ground: the grid spanned by the surface edges, each cell a surface or verge. */
function groundCells(layout: ResolvedLayout): GroundCell[] {
  const { bounds, surfaces } = layout;
  const edges = (lo: number, hi: number, values: number[]): number[] =>
    [...new Set([lo, hi, ...values.filter((v) => v > lo && v < hi)])].sort((a, b) => a - b);
  const xs = edges(
    bounds.minX,
    bounds.maxX,
    surfaces.flatMap((s) => [s.rect.minX, s.rect.maxX]),
  );
  const ys = edges(
    bounds.minY,
    bounds.maxY,
    surfaces.flatMap((s) => [s.rect.minY, s.rect.maxY]),
  );
  const cells: GroundCell[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    for (let j = 0; j + 1 < ys.length; j++) {
      const x0 = xs[i] ?? 0;
      const x1 = xs[i + 1] ?? 0;
      const y0 = ys[j] ?? 0;
      const y1 = ys[j + 1] ?? 0;
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      const surface = surfaces.find(
        ({ rect: r }) => mx > r.minX && mx < r.maxX && my > r.minY && my < r.maxY,
      );
      cells.push({ x0, x1, y0, y1, kind: surface?.kind });
    }
  }
  return cells;
}

const cellColor = (cell: GroundCell, palette: ScenePalette, color: Color): Color =>
  color.set(cell.kind === undefined ? palette.verge : palette[cell.kind]);

const cellHeight = (cell: GroundCell): number => (cell.kind === undefined ? VERGE_Y : SURFACE_Y);

export function groundGeometry(layout: ResolvedLayout, palette: ScenePalette): BufferGeometry {
  const color = new Color();
  const cells = groundCells(layout).map((c) =>
    tint(rectGeometry(c.x0, c.x1, c.y0, c.y1, cellHeight(c)), cellColor(c, palette, color)),
  );
  const merged = mergeGeometries(cells);
  cells.forEach((g) => g.dispose());
  return merged;
}

const GROUND_TEXTURED = Object.values(GROUND_SURFACES);

/**
 * The same cells as `groundGeometry`, carrying world-space UVs (one texture tile per `tile` metres)
 * and which texture channel each cell reads; the verge selects none and keeps its token colour.
 */
export function texturedGroundGeometry(
  layout: ResolvedLayout,
  palette: ScenePalette,
): BufferGeometry {
  const { minX, minY } = layout.bounds;
  const color = new Color();
  const cells = groundCells(layout).map((c) => {
    const geometry = tint(
      rectGeometry(c.x0, c.x1, c.y0, c.y1, cellHeight(c)),
      cellColor(c, palette, color),
    );
    const entry = GROUND_TEXTURED.find((e) => e.surface === c.kind);
    const position = geometry.getAttribute('position');
    const uvs: number[] = [];
    const selects: number[] = [];
    for (let i = 0; i < position.count; i++) {
      const tile = entry?.tile ?? 1;
      uvs.push((position.getX(i) - minX) / tile, (-position.getZ(i) - minY) / tile);
      selects.push(
        entry?.channel === 0 ? 1 : 0,
        entry?.channel === 1 ? 1 : 0,
        entry?.channel === 2 ? 1 : 0,
      );
    }
    return geometry
      .setAttribute('uv', new Float32BufferAttribute(uvs, 2))
      .setAttribute('groundSelect', new Float32BufferAttribute(selects, 3));
  });
  const merged = mergeGeometries(cells);
  cells.forEach((g) => g.dispose());
  return merged;
}
