import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  RingGeometry,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type Texture,
} from 'three';
import { MeshLambertNodeMaterial } from 'three/webgpu';
import type { Marking, Obstacle, ObstacleKind, ResolvedLayout } from '../contracts/layout';
import type { RenderFrame, ScenePalette, ScenePaletteKey } from '../contracts/render';
import { FOG_DENSITY, GRADE, setGraded } from './grade';
import {
  boxGeometry,
  Chunks,
  groundGeometry,
  outlineGeometry,
  rectGeometry,
  texturedGroundGeometry,
  toleranceGeometry,
} from './ground-geometry';
import { createGroundMaterial } from './ground-material';
import type { GroundTextures } from './ground-texture';
import {
  createLightRig,
  perspectiveLight,
  perspectiveSunDirection,
  sunPosition,
} from './light-rig';
import type { QualityFlags } from './quality';
import { AIDS_LAYER, DEFAULT_LAYER, PERSPECTIVE_LAYER, type Environment } from './seams';
import { REALISM_HUES } from './realism-hues';
import { createSkyline } from './skyline';
import { createSceneSky, domeGround } from './scene-sky';
import { tint } from './tint';
import { isOnYard, RESTYLED_KINDS, yardProps } from './yard-props';

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
const BAND_YARD_DIVISOR = 150; // the whole-yard view shows the band this many strokes across the yard
const GATE_STRIP = 0.3;
const GATE_SEGMENTS = 64;
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

export function proceduralEnvironment(
  layout: ResolvedLayout,
  palette: ScenePalette,
  groundTextures?: GroundTextures,
  skyTexture?: GroundTextures,
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
  let texturedGroundMaterial: MeshLambertNodeMaterial | null = null;
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
      let material: MeshLambertNodeMaterial | null = null;
      try {
        geometry = texturedGroundGeometry(layout, palette);
        material = createGroundMaterial(texture);
        setGraded(material, graded);
        const mesh = new Mesh(geometry, material);
        mesh.layers.set(PERSPECTIVE_LAYER);
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
  // the detail copy from yard-props on PERSPECTIVE_LAYER.
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
  // graded props wear their own copy, so the grade never reaches the layer-0 tokens
  const propMaterial = new MeshLambertNodeMaterial({ vertexColors: true });
  setGraded(propMaterial, true);
  const props = detail.meshes(solid, geometries);
  for (const mesh of props) {
    mesh.layers.set(PERSPECTIVE_LAYER);
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

  const rig = createLightRig(palette);
  group.add(rig.object);
  const light = perspectiveLight(palette);
  const sunDirection = perspectiveSunDirection();
  const haze = new Color(REALISM_HUES.skyHaze);
  const sky = createSceneSky(palette);
  const legacyGround = domeGround(palette, false);
  const splitGround = domeGround(palette, true);
  const skyline = createSkyline(layout.bounds, haze);
  group.add(sky.mesh, skyline.mesh);

  let graded = false;
  let hdriOn = false;
  let hdriMap: Texture | null = null;
  let hdriReported = false;
  let disposed = false;
  const syncSky = (): void => {
    const on = hdriOn && hdriMap !== null;
    sky.setHdri(on ? hdriMap : null);
    // the haze uniforms are shared: a disposed environment must not overwrite the live one's
    if (!disposed) {
      GRADE.hazeToward.value.copy(on ? light.hazeToward : haze);
      GRADE.hazeAway.value.copy(on ? light.hazeAway : haze);
    }
    if (on !== hdriReported) {
      hdriReported = on;
      skyTexture?.reportApplied(on);
    }
  };
  const cancelSkyTexture = skyTexture?.onLoaded(
    (map: Texture) => {
      hdriMap = map;
      syncSky();
    },
    () => {
      hdriMap = null;
      syncSky();
    },
  );

  return {
    object: group,
    update(frame: RenderFrame): void {
      if (yardBand !== null) yardBand.visible = frame.topDown === 'yard';
      if (gate !== null) {
        gate.material.color.copy(frame.waypointVisited === true ? gate.passed : gate.pending);
      }
    },
    setQuality(flags: QualityFlags): void {
      graded = flags.perspectiveLighting;
      rig.setSplit(graded);
      sky.setSun(graded ? sunDirection : sunPosition());
      sky.setGround(graded ? splitGround : legacyGround);
      GRADE.sunDirection.value.copy(sunDirection);
      GRADE.fogDensity.value = flags.aerialPerspective ? FOG_DENSITY : 0;
      hdriOn = flags.hdriSky;
      syncSky();
      for (const mesh of props) mesh.material = graded ? propMaterial : solid;
      if (texturedGroundMaterial !== null) setGraded(texturedGroundMaterial, graded);
      skyline.setGraded(graded);
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
      cancelSkyTexture?.();
      disposed = true;
      hdriMap = null;
      hdriOn = false;
      syncSky();
      groundDisabled = true;
      syncGround();
      texturedGroundMaterial?.dispose();
      geometries.forEach((g) => g.dispose());
      gate?.material.dispose();
      solid.dispose();
      propMaterial.dispose();
      flat.dispose();
      sky.dispose();
      skyline.dispose();
    },
  };
}
