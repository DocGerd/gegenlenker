import { type Color, CylinderGeometry } from 'three';
import type { Marking, Obstacle, ObstacleKind } from '../contracts/layout';
import type { ScenePalette, ScenePaletteKey } from '../contracts/render';
import { boxGeometry, type Chunks, rectGeometry } from './ground-geometry';
import { tint } from './tint';

const MARKING_Y = 0.01;
const DASH = 3;
const GAP = 6;
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
  if (kind === 'bollard' || kind === 'barrier' || kind === 'furniture') return 'lamp';
  if (kind === 'gatehouse') return 'wall';
  return kind;
}

export function addObstacle(
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

export function addMarking(m: Marking, chunks: Chunks, color: Color): void {
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
