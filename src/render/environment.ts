import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  Float32BufferAttribute,
  MeshLambertMaterial,
  PlaneGeometry,
  RingGeometry,
  ShaderLib,
  Vector3,
  type Material,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Tolerances } from '../contracts/exercise';
import type {
  Marking,
  Obstacle,
  ObstacleKind,
  Rect2,
  ResolvedLayout,
  SurfaceKind,
} from '../contracts/layout';
import type { RenderFrame, ScenePalette, ScenePaletteKey } from '../contracts/render';
import { GROUND_TEXTURE_MEAN } from './ground-texture-pixels';
import { GROUND_SHADER_MARKER, GROUND_SURFACES } from './ground-texture-spec';
import type { GroundTextures } from './ground-texture';
import type { QualityFlags } from './quality';
import { AIDS_LAYER, DEFAULT_LAYER, SKY_LAYER, type Environment } from './seams';
import { REALISM_HUES } from './realism-hues';
import { createSky, neutralSky, type Sky } from './sky';
import { createSkyline } from './skyline';
import { tint } from './tint';
import { isOnYard, RESTYLED_KINDS, yardProps } from './yard-props';

export { tint };

const VERGE_Y = 0;
const SURFACE_Y = 0.005;
const MARKING_Y = 0.01;
const TARGET_Y = 0.012;
const DASH = 3;
const GAP = 6;
const TARGET_STRIP = 0.15;
const BAND_STRIP = 0.08;
const BAND_CASING = 0.05; // dark edge on each side, so the accent reads on light grounds
const BAND_Y = 0.016;
const BAND_CASING_DROP = 0.005;
const BAND_LIFT = 0.004;
const BAND_RING_SHARE = 0.5;
const BAND_SEGMENTS = 48;
const BAND_YARD_DIVISOR = 150; // the whole-yard view shows the band this many strokes across the yard
const GATE_STRIP = 0.3;
const GATE_SEGMENTS = 64;
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
const SUN_INTENSITY = 2.4;
const HEMISPHERE_INTENSITY = 1.4;

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
  if (kind === 'kerb' && onYard) return 'band';
  if (kind === 'bollard' || kind === 'barrier') return 'lamp';
  if (kind === 'gatehouse') return 'wall';
  return kind;
}

export { isOnYard };

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

function groundGeometry(layout: ResolvedLayout, palette: ScenePalette): BufferGeometry {
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

/** Replaces `anchor` once; throws when three's shader no longer contains it, so a patch never half-applies. */
function inject(source: string, anchor: string, replacement: string): string {
  if (!source.includes(anchor)) throw new Error(`Ground shader: ${anchor} not found`);
  return source.replace(anchor, replacement);
}

/**
 * Lambert shading with the ground map read per vertex-selected channel, scaled so the surface keeps
 * its token brightness on average (the sky below the horizon is matched to it). Bright surfaces
 * would exceed their token with a bright texel, so the product is clamped to 1.
 */
export function groundShader(
  shader: Pick<WebGLProgramParametersWithUniforms, 'vertexShader' | 'fragmentShader'>,
): void {
  const gain = (1 / GROUND_TEXTURE_MEAN).toFixed(6);
  const vertexShader = inject(
    inject(
      shader.vertexShader,
      '#include <common>',
      '#include <common>\nattribute vec3 groundSelect;\nvarying vec3 vGroundSelect;',
    ),
    '#include <begin_vertex>',
    '#include <begin_vertex>\nvGroundSelect = groundSelect;',
  );
  const fragmentShader = inject(
    inject(
      shader.fragmentShader,
      '#include <common>',
      '#include <common>\nvarying vec3 vGroundSelect;',
    ),
    '#include <map_fragment>',
    `#ifdef USE_MAP
        vec3 ${GROUND_SHADER_MARKER} = texture2D( map, vMapUv ).rgb;
        float groundWeight = vGroundSelect.x + vGroundSelect.y + vGroundSelect.z;
        diffuseColor.rgb = min(
          diffuseColor.rgb * mix( 1.0, dot( ${GROUND_SHADER_MARKER}, vGroundSelect ) * ${gain}, groundWeight ),
          vec3( 1.0 )
        );
      #endif`,
  );
  shader.vertexShader = vertexShader;
  shader.fragmentShader = fragmentShader;
}

/** The sun's position relative to the origin: south-west, where world (−, −) is Three (−x, +z). */
export function sunPosition(): Vector3 {
  const horizontal = Math.cos(SUN_ELEVATION) * SUN_DISTANCE;
  return new Vector3(
    -horizontal / Math.SQRT2,
    Math.sin(SUN_ELEVATION) * SUN_DISTANCE,
    horizontal / Math.SQRT2,
  );
}

/** The dome the perspective views show; the vehicle reflections are captured from the same one. */
export function createSceneSky(palette: ScenePalette): Sky {
  const ambient = neutralSky(palette.sky);
  // Radiance of an upward-facing Lambert surface, so the dome below the horizon matches the ground.
  const lit =
    (HEMISPHERE_INTENSITY * ambient.r + SUN_INTENSITY * Math.sin(SUN_ELEVATION)) / Math.PI;
  return createSky(
    new Color(palette.sky),
    new Color(palette.verge).multiplyScalar(Math.min(1, lit)),
    new Color(REALISM_HUES.skyHaze),
    new Color(REALISM_HUES.sunHalo),
    sunPosition(),
  );
}

export function proceduralEnvironment(
  layout: ResolvedLayout,
  palette: ScenePalette,
  groundTextures?: GroundTextures,
): Environment {
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
  const tokenGround = new Mesh(ground, solid);
  group.add(tokenGround);

  // High: perspective cameras draw this textured copy of the ground instead, top-down keeps the tokens.
  let texturedGround: Mesh | null = null;
  let texturedGroundMaterial: MeshLambertMaterial | null = null;
  let groundTextureOn = false;
  let groundDisabled = false;
  let groundReported = false;
  const syncGround = (): void => {
    const on = groundTextureOn && texturedGround !== null && !groundDisabled;
    tokenGround.layers.set(on ? AIDS_LAYER : DEFAULT_LAYER);
    if (texturedGround !== null) texturedGround.visible = on;
    if (on !== groundReported) {
      groundReported = on;
      groundTextures?.reportApplied(on);
    }
  };
  const cancelGroundTexture = groundTextures?.onLoaded(
    (texture: Texture) => {
      let geometry: BufferGeometry | null = null;
      let material: MeshLambertMaterial | null = null;
      try {
        // the patch runs at first render, where a throw would escape; prove it applies to this three
        groundShader({
          vertexShader: ShaderLib.lambert.vertexShader,
          fragmentShader: ShaderLib.lambert.fragmentShader,
        });
        geometry = texturedGroundGeometry(layout, palette);
        material = new MeshLambertMaterial({ vertexColors: true, map: texture });
        material.onBeforeCompile = groundShader;
        material.customProgramCacheKey = () => 'ground-detail';
        const mesh = new Mesh(geometry, material);
        mesh.layers.set(SKY_LAYER);
        group.add(mesh);
        geometries.push(geometry);
        texturedGroundMaterial = material;
        texturedGround = mesh;
        syncGround();
      } catch (error) {
        geometry?.dispose();
        material?.dispose();
        console.warn('Ground texture could not be applied; keeping the token ground', error);
      }
    },
    () => {
      groundDisabled = true;
      syncGround();
    },
  );

  // Restyled kinds keep a plain token copy for the top-down view only; the cockpit and mirrors draw
  // the detail copy from yard-props on SKY_LAYER.
  const obstacles = new Chunks(layout.bounds);
  const topDownOnly = new Chunks(layout.bounds);
  const detail = new Chunks(layout.bounds);
  const { yard } = layout;
  for (const o of layout.obstacles) {
    const { cx, cy } = o.obb;
    const chunks = RESTYLED_KINDS.has(o.kind) ? topDownOnly : obstacles;
    addObstacle(o, palette, chunks, color, roof, isOnYard(yard, cx, cy));
  }
  for (const mesh of obstacles.meshes(solid, geometries)) group.add(mesh);
  const tokens = topDownOnly.meshes(solid, geometries);
  for (const mesh of tokens) {
    mesh.layers.set(AIDS_LAYER);
    group.add(mesh);
  }
  for (const piece of yardProps(layout)) detail.add(piece.x, piece.y, piece.geometry);
  const props = detail.meshes(solid, geometries);
  for (const mesh of props) {
    mesh.layers.set(SKY_LAYER);
    group.add(mesh);
  }

  const markings = new Chunks(layout.bounds);
  color.set(palette.marking);
  for (const m of layout.markings) addMarking(m, markings, color);
  for (const mesh of markings.meshes(flat, geometries)) group.add(mesh);

  let yardBand: Group | null = null;
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

    const { tolerances } = layout;
    if (tolerances !== null) {
      const place = (g: BufferGeometry, y: number): BufferGeometry =>
        g.rotateY(target.pose.heading).translate(target.pose.x, y, -target.pose.y);
      const addBand = (strip: number, lift: number): Mesh[] => {
        const casing = place(
          toleranceGeometry(
            tolerances,
            target.length,
            strip + 2 * BAND_CASING * (strip / BAND_STRIP),
          ),
          BAND_Y + lift - BAND_CASING_DROP,
        );
        color.set(palette.wheel);
        tint(casing, color);
        color.set(palette.accent);
        const band = tint(
          place(toleranceGeometry(tolerances, target.length, strip), BAND_Y + lift),
          color,
        );
        geometries.push(casing, band);
        return [new Mesh(casing, flat), new Mesh(band, flat)];
      };
      group.add(...addBand(BAND_STRIP, 0));

      // World-metre strokes shrink to under a pixel in the whole-yard view, so it gets a wider copy.
      const { yard } = layout;
      const yardStrip = Math.min(
        Math.max(yard.maxX - yard.minX, yard.maxY - yard.minY) / BAND_YARD_DIVISOR,
        tolerances.position * BAND_RING_SHARE, // a stroke wider than the tolerance would blur the ring
      );
      if (yardStrip > BAND_STRIP) {
        yardBand = new Group();
        for (const m of addBand(yardStrip, BAND_LIFT)) yardBand.add(m);
        yardBand.traverse((o) => o.layers.set(AIDS_LAYER));
        group.add(yardBand);
      }
    }
  }

  const { waypoint } = layout;
  let gate: { material: MeshBasicMaterial; pending: Color; passed: Color } | null = null;
  if (waypoint !== null) {
    const half = GATE_STRIP / 2;
    const ring = new RingGeometry(waypoint.radius - half, waypoint.radius + half, GATE_SEGMENTS)
      .rotateX(-Math.PI / 2)
      .translate(waypoint.x, TARGET_Y, -waypoint.y);
    const material = new MeshBasicMaterial({
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    geometries.push(ring);
    group.add(new Mesh(ring, material));
    gate = { material, pending: new Color(palette.accent), passed: new Color(palette.marking) };
    material.color.copy(gate.pending);
  }

  const sun = new DirectionalLight(0xffffff, SUN_INTENSITY);
  sun.position.copy(sunPosition());
  const ambient = neutralSky(palette.sky);
  group.add(sun, new HemisphereLight(ambient, palette.verge, HEMISPHERE_INTENSITY));

  const haze = new Color(REALISM_HUES.skyHaze);
  const sky = createSceneSky(palette);
  const skyline = createSkyline(layout.bounds, haze);
  group.add(sky.mesh, skyline.mesh);

  return {
    object: group,
    update(frame: RenderFrame): void {
      if (yardBand !== null) yardBand.visible = frame.topDown === 'yard';
      if (gate !== null) {
        gate.material.color.copy(frame.waypointVisited === true ? gate.passed : gate.pending);
      }
    },
    setQuality(flags: QualityFlags): void {
      skyline.mesh.visible = flags.skyline;
      groundTextureOn = flags.groundTexture;
      syncGround();
      for (const mesh of props) mesh.visible = flags.yardDetail;
      // Without the props the obstacles must still show in perspective, so the tokens go to every camera.
      for (const mesh of tokens) {
        if (flags.yardDetail) mesh.layers.set(AIDS_LAYER);
        else mesh.layers.enable(DEFAULT_LAYER);
      }
    },
    dispose: () => {
      cancelGroundTexture?.();
      groundDisabled = true;
      syncGround();
      texturedGroundMaterial?.dispose();
      geometries.forEach((g) => g.dispose());
      gate?.material.dispose();
      solid.dispose();
      flat.dispose();
      sky.dispose();
      skyline.dispose();
    },
  };
}
