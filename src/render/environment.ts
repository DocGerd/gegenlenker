import {
  BoxGeometry,
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Marking, Obstacle, Rect2, ResolvedLayout } from '../contracts/layout';
import type { ScenePalette } from '../contracts/render';
import type { Environment } from './seams';

const VERGE_Y = 0;
const SURFACE_Y = 0.005;
const MARKING_Y = 0.01;
const TARGET_Y = 0.012;
const DASH = 3;
const GAP = 6;
const TARGET_STRIP = 0.15;
const CHUNK = 60; // spatial chunk edge: frustum culling works per chunk
const SPLIT = 30; // long boxes and lines are cut so a chunk's bounds stay local
const LAMP_HEAD = { length: 1, width: 0.35, height: 0.25, offset: 0.35 };
const SUN_ELEVATION = (50 * Math.PI) / 180;
const SUN_DISTANCE = 100;

/** Flat rectangle in the ground plane; x forward, y left (Three z = −y). */
function rectGeometry(x0: number, x1: number, y0: number, y1: number, up = 0): BufferGeometry {
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

/** Drops uv and adds a linear vertex colour so one material serves every colour. */
function tint(geometry: BufferGeometry, color: Color): BufferGeometry {
  geometry.deleteAttribute('uv');
  const n = geometry.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  return geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
}

function boxGeometry(
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

class Chunks {
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

/** Calls `fn` for equal pieces of at most SPLIT along a line centred on (cx, cy). */
function splitLine(
  cx: number,
  cy: number,
  length: number,
  heading: number,
  fn: (px: number, py: number, pieceLength: number) => void,
): void {
  const n = Math.max(1, Math.ceil(length / SPLIT));
  const step = length / n;
  for (let i = 0; i < n; i++) {
    const offset = -length / 2 + step * (i + 0.5);
    fn(cx + Math.cos(heading) * offset, cy + Math.sin(heading) * offset, step);
  }
}

function addObstacle(o: Obstacle, palette: ScenePalette, chunks: Chunks, color: Color): void {
  const { obb, height, kind } = o;
  color.set(palette[kind]);
  // cut along the longer side so no piece spans several chunks
  const crosswise = obb.halfWidth > obb.halfLength;
  const along = (crosswise ? obb.halfWidth : obb.halfLength) * 2;
  const across = (crosswise ? obb.halfLength : obb.halfWidth) * 2;
  const heading = crosswise ? obb.heading + Math.PI / 2 : obb.heading;
  splitLine(obb.cx, obb.cy, along, heading, (px, py, piece) =>
    chunks.add(px, py, tint(boxGeometry(px, py, piece, across, heading, 0, height), color)),
  );
  if (kind === 'lamp') {
    const hx = obb.cx + Math.cos(obb.heading) * LAMP_HEAD.offset;
    const hy = obb.cy + Math.sin(obb.heading) * LAMP_HEAD.offset;
    chunks.add(
      hx,
      hy,
      tint(
        boxGeometry(
          hx,
          hy,
          LAMP_HEAD.length,
          LAMP_HEAD.width,
          obb.heading,
          height,
          height + LAMP_HEAD.height,
        ),
        color,
      ),
    );
  }
}

function addMarking(m: Marking, chunks: Chunks, color: Color): void {
  const dx = m.to.x - m.from.x;
  const dy = m.to.y - m.from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return;
  const heading = Math.atan2(dy, dx);
  const piece = (px: number, py: number, pieceLength: number): void => {
    chunks.add(
      px,
      py,
      tint(
        rectGeometry(-pieceLength / 2, pieceLength / 2, -m.width / 2, m.width / 2)
          .rotateY(heading)
          .translate(px, MARKING_Y, -py),
        color,
      ),
    );
  };
  if (!m.dashed) {
    splitLine(m.from.x + dx / 2, m.from.y + dy / 2, length, heading, piece);
    return;
  }
  for (let s = 0; s < length; s += DASH + GAP) {
    const d = Math.min(DASH, length - s);
    const mid = s + d / 2;
    piece(m.from.x + (dx / length) * mid, m.from.y + (dy / length) * mid, d);
  }
}

/** Non-overlapping ground: the grid spanned by the surface edges, each cell a surface or verge. */
function groundGeometry(layout: ResolvedLayout, palette: ScenePalette): BufferGeometry {
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
  const color = new Color();
  const cells: BufferGeometry[] = [];
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
      color.set(surface === undefined ? palette.verge : palette[surface.kind]);
      cells.push(
        tint(rectGeometry(x0, x1, y0, y1, surface === undefined ? VERGE_Y : SURFACE_Y), color),
      );
    }
  }
  const merged = mergeGeometries(cells);
  cells.forEach((g) => g.dispose());
  return merged;
}

export function proceduralEnvironment(layout: ResolvedLayout, palette: ScenePalette): Environment {
  const group = new Group();
  const geometries: BufferGeometry[] = [];
  const solid = new MeshLambertMaterial({ vertexColors: true });
  const flat = new MeshBasicMaterial({
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const color = new Color();

  const ground = groundGeometry(layout, palette);
  geometries.push(ground);
  group.add(new Mesh(ground, solid));

  const obstacles = new Chunks(layout.bounds);
  for (const o of layout.obstacles) addObstacle(o, palette, obstacles, color);
  group.add(...obstacles.meshes(solid, geometries));

  const markings = new Chunks(layout.bounds);
  color.set(palette.marking);
  for (const m of layout.markings) addMarking(m, markings, color);
  group.add(...markings.meshes(flat, geometries));

  const { target } = layout;
  if (target !== null) {
    color.set(palette.accent);
    const outline = tint(
      outlineGeometry(target.length, target.width, TARGET_STRIP)
        .rotateY(target.pose.heading)
        .translate(target.pose.x, TARGET_Y, -target.pose.y),
      color,
    );
    geometries.push(outline);
    group.add(new Mesh(outline, flat));
  }

  const sun = new DirectionalLight(0xffffff, 2.4);
  const horizontal = Math.cos(SUN_ELEVATION) * SUN_DISTANCE;
  // south-west: world (−, −) is Three (−x, +z)
  sun.position.set(
    -horizontal / Math.SQRT2,
    Math.sin(SUN_ELEVATION) * SUN_DISTANCE,
    horizontal / Math.SQRT2,
  );
  group.add(sun, new HemisphereLight(palette.sky, palette.verge, 1.4));

  return {
    object: group,
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      solid.dispose();
      flat.dispose();
    },
  };
}
