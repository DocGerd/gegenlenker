import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
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
import type { Marking, Obstacle, ObstacleKind, Rect2, ResolvedLayout } from '../contracts/layout';
import type { ScenePalette, ScenePaletteKey } from '../contracts/render';
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
const LAMP_HEAD_HEIGHT = 0.4; // the head fills the obstacle footprint, the pole is slimmer
const LAMP_POLE_RATIO = 0.5;
const PLINTH = 2.4; // hall height below the cladding
const LAMP_BANDS = 3; // lamp plinth: dark / white / dark
const POST_BAND = 0.4;
const CONE_BASE = 0.05; // dark plate under the cone, the full collision footprint
const CONE_BANDS = 3;
const CONE_SIDES = 8;
const CONE_TOP_RATIO = 0.25;
const CONE_RADIUS_RATIO = 0.8; // of the smaller footprint half-extent
const BOX_TOP_FACE_FIRST_VERTEX = 8; // BoxGeometry orders +x, -x, +y, ...: four vertices per face
const BOX_FACE_VERTICES = 4;
const SUN_ELEVATION = (50 * Math.PI) / 180;
const SUN_DISTANCE = 100;

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

/** Drops uv and adds a linear vertex colour so one material serves every colour. */
export function tint(geometry: BufferGeometry, color: Color): BufferGeometry {
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

/** Red cone with white bands: a plate over the collision footprint under a tapered body. */
function addCone(o: Obstacle, palette: ScenePalette, chunks: Chunks, color: Color): void {
  const { cx, cy, halfLength, halfWidth, heading } = o.obb;
  color.set(palette.band);
  chunks.add(
    cx,
    cy,
    tint(boxGeometry(cx, cy, halfLength * 2, halfWidth * 2, heading, 0, CONE_BASE), color),
  );
  const bottom = Math.min(halfLength, halfWidth) * CONE_RADIUS_RATIO;
  const top = bottom * CONE_TOP_RATIO;
  const step = (o.height - CONE_BASE) / CONE_BANDS;
  for (let i = 0; i < CONE_BANDS; i++) {
    const radiusLow = bottom + ((top - bottom) * i) / CONE_BANDS;
    const radiusHigh = bottom + ((top - bottom) * (i + 1)) / CONE_BANDS;
    color.set(i % 2 === 0 ? palette.cone : palette.marking);
    const band = new CylinderGeometry(
      radiusHigh,
      radiusLow,
      step,
      CONE_SIDES,
      1,
      i < CONE_BANDS - 1,
    ).translate(cx, CONE_BASE + step * (i + 0.5), -cy);
    chunks.add(cx, cy, tint(band, color));
  }
}

/** Yard kerbs are dark so they stand out from the yard; street kerbs stay light. */
export function obstaclePaletteKey(kind: ObstacleKind, onYard: boolean): ScenePaletteKey {
  return kind === 'kerb' && onYard ? 'band' : kind;
}

export function isOnYard(yard: Rect2, cx: number, cy: number): boolean {
  return cx > yard.minX && cx < yard.maxX && cy > yard.minY && cy < yard.maxY;
}

function addObstacle(
  o: Obstacle,
  palette: ScenePalette,
  chunks: Chunks,
  color: Color,
  roof: Color,
  onYard: boolean,
): void {
  const { obb, height, kind } = o;
  if (kind === 'cone') {
    addCone(o, palette, chunks, color);
    return;
  }
  color.set(palette[obstaclePaletteKey(kind, onYard)]);
  if (kind === 'lamp') {
    const { cx, cy, heading } = obb;
    const [length, width] = [obb.halfLength * 2, obb.halfWidth * 2];
    const top = height - LAMP_HEAD_HEIGHT;
    for (let i = 0; i < LAMP_BANDS; i++) {
      color.set(i === 1 ? palette.marking : palette.lamp);
      const band = boxGeometry(cx, cy, length, width, heading, i * POST_BAND, (i + 1) * POST_BAND);
      chunks.add(cx, cy, tint(band, color));
    }
    color.set(palette.lamp);
    const pole = boxGeometry(
      cx,
      cy,
      length * LAMP_POLE_RATIO,
      width * LAMP_POLE_RATIO,
      heading,
      LAMP_BANDS * POST_BAND,
      top,
    );
    chunks.add(cx, cy, tint(pole, color));
    chunks.add(cx, cy, tint(boxGeometry(cx, cy, length, width, heading, top, height), color));
    return;
  }
  // cut along the longer side so no piece spans several chunks
  const crosswise = obb.halfWidth > obb.halfLength;
  const along = (crosswise ? obb.halfWidth : obb.halfLength) * 2;
  const across = (crosswise ? obb.halfLength : obb.halfWidth) * 2;
  const heading = crosswise ? obb.heading + Math.PI / 2 : obb.heading;
  if (kind === 'hall' && height > PLINTH) {
    roof.set(palette.hall);
    splitLine(obb.cx, obb.cy, along, heading, (px, py, piece) => {
      color.set(palette.hall);
      chunks.add(px, py, tint(boxGeometry(px, py, piece, across, heading, 0, PLINTH), color));
      color.set(palette.cladding);
      const upper = tint(boxGeometry(px, py, piece, across, heading, PLINTH, height), color);
      const colors = upper.getAttribute('color');
      for (
        let v = BOX_TOP_FACE_FIRST_VERTEX;
        v < BOX_TOP_FACE_FIRST_VERTEX + BOX_FACE_VERTICES;
        v++
      ) {
        colors.setXYZ(v, roof.r, roof.g, roof.b);
      }
      chunks.add(px, py, upper);
    });
    return;
  }
  splitLine(obb.cx, obb.cy, along, heading, (px, py, piece) =>
    chunks.add(px, py, tint(boxGeometry(px, py, piece, across, heading, 0, height), color)),
  );
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
  const roof = new Color();

  const ground = groundGeometry(layout, palette);
  geometries.push(ground);
  group.add(new Mesh(ground, solid));

  const obstacles = new Chunks(layout.bounds);
  const { yard } = layout;
  for (const o of layout.obstacles) {
    const { cx, cy } = o.obb;
    addObstacle(o, palette, obstacles, color, roof, isOnYard(yard, cx, cy));
  }
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
