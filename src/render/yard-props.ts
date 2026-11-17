import { Color, type BufferGeometry } from 'three';
import type { Obstacle, ResolvedLayout } from '../contracts/layout';
import { REALISM_HUES as HUE } from './realism-hues';
import { tint } from './tint';
import { box, merge } from './vehicle-geometry';

/*
 * Perspective-only yard detail in realism hues, on SKY_LAYER: the top-down view draws the plain token
 * copy of these obstacles instead. Everything stays inside the obstacle's OBB, apart from thin relief
 * (seals, bumpers, signs, boom, floodlights), so a prop never looks bigger than it collides.
 */

export type PropPiece = {
  readonly x: number;
  readonly y: number;
  readonly geometry: BufferGeometry;
};

type Range = readonly [number, number];

const SPLIT = 30; // long props are cut so a chunk's bounds stay local
const PLINTH = 2.4;
const FASCIA = 0.6;
const RIB = 0.06;
const RIB_WIDTH = 0.14;
const RIB_PITCH = 0.5;
const ROOF = 0.3;
const OPENING_HEIGHT = 4.8;
const SEAL = 0.12;
const MAX_OPENING = 10;
const SIGN = { width: 6, bottom: 5.2, height: 1.6, relief: 0.12, minWall: 10 };
const DOOR = { width: 2.7, height: 2.8, lift: 0.1, relief: 0.08, frame: 0.15 };
const BUMPER = { offset: 1, width: 0.25, bottom: 0.85, top: 1.15, relief: 0.1 };
const GUIDE = { offset: 1.45, width: 0.1, length: 2.4, height: 0.12, setback: 0.3 };
const FENCE = { postPitch: 2.5, barPitch: 0.25, barWidth: 0.025, rails: 3 };
const TYRE = { width: 0.3, length: 1, height: 1 };
const CONTAINER_HUES = [
  HUE.containerBlue,
  HUE.containerRed,
  HUE.containerGreen,
  HUE.containerOrange,
] as const;
const CURTAIN_HUES = [HUE.whiteAluminium, HUE.containerBlue, HUE.containerGreen] as const;
const TRAILER_MIN_LENGTH = 13;
const BOOM = { length: 4.5, thickness: 0.1, stripe: 0.5, lift: (85 * Math.PI) / 180 };
const MAST_HEIGHT_MIN = 9;
const FLOODLIGHTS = 3;

/** Boxes in a local frame (x forward, y left, z up), merged and placed at a world pose. */
class Parts {
  private readonly list: BufferGeometry[] = [];

  box(x: Range, y: Range, z: Range, hue: number, shade = 1): this {
    return this.add(box(x, y, z), hue, shade);
  }

  add(geometry: BufferGeometry, hue: number, shade = 1): this {
    this.list.push(tint(geometry, new Color(hue).multiplyScalar(shade)));
    return this;
  }

  place(cx: number, cy: number, heading: number): BufferGeometry {
    return merge(this.list).rotateY(heading).translate(cx, 0, -cy);
  }
}

const around = (centre: number, half: number): Range => [centre - half, centre + half];

/** Along-axis length, across-axis width and heading of a long box, cut along the longer side. */
function longFrame({ obb }: Obstacle): { along: number; across: number; heading: number } {
  const crosswise = obb.halfWidth > obb.halfLength;
  return {
    along: (crosswise ? obb.halfWidth : obb.halfLength) * 2,
    across: (crosswise ? obb.halfLength : obb.halfWidth) * 2,
    heading: crosswise ? obb.heading + Math.PI / 2 : obb.heading,
  };
}

function longPieces(
  o: Obstacle,
  build: (parts: Parts, length: number, across: number) => void,
): PropPiece[] {
  const { along, across, heading } = longFrame(o);
  const n = Math.max(1, Math.ceil(along / SPLIT));
  const step = along / n;
  const out: PropPiece[] = [];
  for (let i = 0; i < n; i++) {
    const offset = -along / 2 + step * (i + 0.5);
    const x = o.obb.cx + Math.cos(heading) * offset;
    const y = o.obb.cy + Math.sin(heading) * offset;
    const parts = new Parts();
    build(parts, step, across);
    out.push({ x, y, geometry: parts.place(x, y, heading) });
  }
  return out;
}

/** Double-bar mesh fence: posts, rails and a bar grid, see-through between the bars. */
function fence(o: Obstacle): PropPiece[] {
  const h = o.height;
  return longPieces(o, (p, length, across) => {
    const post = across * 0.8;
    const rail = across * 0.6;
    const posts = Math.max(1, Math.ceil(length / FENCE.postPitch));
    for (let i = 0; i <= posts; i++) {
      p.box(
        around(-length / 2 + (length * i) / posts, post / 2),
        around(0, post / 2),
        [0, h],
        HUE.anthracite,
      );
    }
    for (let r = 0; r < FENCE.rails; r++) {
      const z = 0.15 + ((h - 0.3) * r) / (FENCE.rails - 1);
      p.box([-length / 2, length / 2], around(0, rail / 2), [z, z + 0.04], HUE.anthracite);
    }
    const bars = Math.floor(length / FENCE.barPitch);
    for (let i = 0; i < bars; i++) {
      const x = -length / 2 + FENCE.barPitch * (i + 0.5);
      p.box(
        around(x, FENCE.barWidth / 2),
        around(0, across * 0.15),
        [0.1, h - 0.05],
        HUE.anthracite,
      );
    }
  });
}

/** Plinth, trapezoidal cladding ribs and a roof-edge fascia on a wall box. */
function hallWall(o: Obstacle): PropPiece[] {
  const h = o.height;
  return longPieces(o, (p, length, across) => {
    const x: Range = [-length / 2, length / 2];
    const top = h - FASCIA;
    p.box(x, around(0, across / 2), [0, PLINTH], HUE.anthracite);
    p.box(x, around(0, across / 2 - RIB), [PLINTH, top], HUE.whiteAluminium, 0.8);
    p.box(x, around(0, across / 2), [top, h], HUE.anthracite);
    const ribs = Math.floor(length / RIB_PITCH);
    for (let i = 0; i < ribs; i++) {
      const rx = around(-length / 2 + RIB_PITCH * (i + 0.5), RIB_WIDTH / 2);
      for (const side of [-1, 1]) {
        const ry: Range =
          side > 0 ? [across / 2 - RIB, across / 2] : [-across / 2, -across / 2 + RIB];
        p.box(rx, ry, [PLINTH, top], HUE.whiteAluminium);
      }
    }
  });
}

type Footprint = { minX: number; minY: number; maxX: number; maxY: number };

const footprint = ({ obb }: Obstacle): Footprint => ({
  minX: obb.cx - obb.halfLength,
  maxX: obb.cx + obb.halfLength,
  minY: obb.cy - obb.halfWidth,
  maxY: obb.cy + obb.halfWidth,
});

const isAxisAligned = ({ obb }: Obstacle): boolean => Math.sin(obb.heading) === 0;

/** A world-frame piece: local coordinates are world metres. */
function worldPiece(x: number, y: number, parts: Parts): PropPiece {
  return { x, y, geometry: parts.place(0, 0, 0) };
}

/** Walls along x with a gap between consecutive pieces on one line: the gate openings. */
function openings(halls: readonly Obstacle[]): { x: Range; y: Range; height: number }[] {
  const lines = new Map<string, Obstacle[]>();
  for (const o of halls.filter((h) => isAxisAligned(h) && h.obb.halfLength > h.obb.halfWidth)) {
    const key = `${o.obb.cy}|${o.obb.halfWidth}`;
    lines.set(key, [...(lines.get(key) ?? []), o]);
  }
  const out: { x: Range; y: Range; height: number }[] = [];
  for (const line of lines.values()) {
    const sorted = line.map((o) => ({ o, f: footprint(o) })).sort((a, b) => a.f.minX - b.f.minX);
    for (let i = 0; i + 1 < sorted.length; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      if (a === undefined || b === undefined) continue;
      const gap = b.f.minX - a.f.maxX;
      if (gap > 0 && gap <= MAX_OPENING) {
        out.push({ x: [a.f.maxX, b.f.minX], y: [a.f.minY, a.f.maxY], height: a.o.height });
      }
    }
  }
  return out;
}

function hallDetail(layout: ResolvedLayout, halls: readonly Obstacle[]): PropPiece[] {
  const out: PropPiece[] = [];
  const rects = halls.filter(isAxisAligned).map(footprint);
  const height = Math.max(...halls.map((o) => o.height));

  // A ring of walls has no top: roof it, so the cockpit sees a ceiling and the top-down view the floor.
  const bounds = {
    minX: Math.min(...rects.map((r) => r.minX)),
    minY: Math.min(...rects.map((r) => r.minY)),
    maxX: Math.max(...rects.map((r) => r.maxX)),
    maxY: Math.max(...rects.map((r) => r.maxY)),
  };
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const covered = rects.some((r) => cx > r.minX && cx < r.maxX && cy > r.minY && cy < r.maxY);
  if (!covered) {
    const slab = new Parts()
      .box(
        [bounds.minX, bounds.maxX],
        [bounds.minY, bounds.maxY],
        [height, height + 0.05],
        HUE.whiteAluminium,
      )
      .box(
        [bounds.minX, bounds.maxX],
        [bounds.minY, bounds.maxY],
        [height + 0.05, height + ROOF],
        HUE.anthracite,
      );
    out.push(worldPiece(cx, cy, slab));
  }

  for (const gate of openings(halls)) {
    const [x0, x1] = gate.x;
    const parts = new Parts()
      .box(gate.x, gate.y, [OPENING_HEIGHT, gate.height], HUE.whiteAluminium, 0.8)
      .box(gate.x, gate.y, [gate.height - FASCIA, gate.height], HUE.anthracite)
      .box([x0, x1], gate.y, [OPENING_HEIGHT - SEAL, OPENING_HEIGHT], HUE.chevronBlack)
      .box([x0, x0 + SEAL], gate.y, [0, OPENING_HEIGHT], HUE.chevronBlack)
      .box([x1 - SEAL, x1], gate.y, [0, OPENING_HEIGHT], HUE.chevronBlack);
    out.push(worldPiece((x0 + x1) / 2, gate.y[0], parts));
  }

  // Blank sign panel on the longest wall run of the street-side face.
  const southY = Math.min(...rects.map((r) => r.minY));
  for (const r of rects) {
    if (r.minY !== southY || r.maxX - r.minX < SIGN.minWall) continue;
    const c = (r.minX + r.maxX) / 2;
    const [y0, y1] = [r.minY - SIGN.relief, r.minY];
    const top = SIGN.bottom + SIGN.height;
    const sign = new Parts()
      .box(around(c, SIGN.width / 2), [y0, y1], [SIGN.bottom, top], HUE.anthracite)
      .box(
        around(c, SIGN.width / 2 - 0.2),
        [y0 - 0.03, y0],
        [SIGN.bottom + 0.2, top - 0.2],
        HUE.whiteAluminium,
        1.25,
      );
    out.push(worldPiece(c, r.minY, sign));
  }

  out.push(...docks(layout, halls));
  return out;
}

/** Dock doors, bumpers, lights and wheel guides where a ramp meets a hall wall, one per bay. */
function docks(layout: ResolvedLayout, halls: readonly Obstacle[]): PropPiece[] {
  const out: PropPiece[] = [];
  for (const ramp of layout.obstacles.filter((o) => o.kind === 'ramp' && isAxisAligned(o))) {
    const r = footprint(ramp);
    const wall = halls
      .filter(isAxisAligned)
      .map(footprint)
      .find((f) => Math.abs(f.minY - r.maxY) < 1e-6 && f.minX < r.maxX && f.maxX > r.minX);
    if (wall === undefined) continue;
    const lines = layout.markings
      .filter(
        (m) =>
          m.kind === 'bay' &&
          Math.abs(m.from.y - r.minY) < 0.01 &&
          m.from.x > r.minX - 0.01 &&
          m.from.x < r.maxX + 0.01,
      )
      .map((m) => m.from.x)
      .sort((a, b) => a - b);
    const sill = ramp.height + DOOR.lift;
    for (let i = 0; i + 1 < lines.length; i++) {
      const c = ((lines[i] ?? 0) + (lines[i + 1] ?? 0)) / 2;
      const face = wall.minY;
      const doorY: Range = [face - DOOR.relief, face];
      const frameY: Range = [face - DOOR.relief - 0.04, face];
      const top = sill + DOOR.height;
      const half = DOOR.width / 2;
      const p = new Parts()
        .box(around(c, half), doorY, [sill, top], HUE.whiteAluminium, 1.15)
        .box([c - half - DOOR.frame, c - half], frameY, [sill, top + DOOR.frame], HUE.chevronBlack)
        .box([c + half, c + half + DOOR.frame], frameY, [sill, top + DOOR.frame], HUE.chevronBlack)
        .box([c - half, c + half], frameY, [top, top + DOOR.frame], HUE.chevronBlack);
      for (let g = 1; g <= 3; g++) {
        const z = sill + (DOOR.height * g) / 4;
        p.box(
          around(c, half),
          [face - DOOR.relief - 0.02, face],
          [z - 0.02, z + 0.02],
          HUE.anthracite,
        );
      }
      const lightX = c + half + DOOR.frame + 0.15;
      p.box(around(lightX, 0.1), [face - 0.14, face], [top - 0.7, top - 0.1], HUE.chevronBlack)
        .box(
          around(lightX, 0.06),
          [face - 0.16, face - 0.14],
          [top - 0.35, top - 0.2],
          HUE.tailLamp,
        )
        .box(
          around(lightX, 0.06),
          [face - 0.16, face - 0.14],
          [top - 0.65, top - 0.5],
          HUE.containerGreen,
        );
      for (const side of [-1, 1]) {
        p.box(
          around(c + side * BUMPER.offset, BUMPER.width / 2),
          [r.minY - BUMPER.relief, r.minY],
          [BUMPER.bottom, BUMPER.top],
          HUE.chevronBlack,
        ).box(
          around(c + side * GUIDE.offset, GUIDE.width / 2),
          [r.minY - GUIDE.setback - GUIDE.length, r.minY - GUIDE.setback],
          [0, GUIDE.height],
          HUE.signalYellow,
        );
      }
      out.push(worldPiece(c, r.minY, p));
    }
  }
  return out;
}

/** Container on a skeletal chassis: corrugation, corner castings, locking rods, tyres. */
function container(o: Obstacle, index: number): PropPiece {
  const { along: l, across: w, heading } = longFrame(o);
  const h = o.height;
  const deck = 0.9;
  const hue = CONTAINER_HUES[index % CONTAINER_HUES.length] ?? HUE.containerBlue;
  const x: Range = [-l / 2, l / 2];
  const p = new Parts();
  for (const side of [-1, 1]) {
    p.box(x, around(side * (w / 2 - 0.25), 0.1), [0.55, deck], HUE.anthracite);
    for (const axle of [1.6, 2.9]) {
      const y: Range = side > 0 ? [w / 2 - TYRE.width, w / 2] : [-w / 2, -w / 2 + TYRE.width];
      p.box(around(l / 2 - axle, TYRE.length / 2), y, [0, TYRE.height], HUE.chevronBlack);
    }
    p.box(
      around(-l / 2 + 1.6, 0.08),
      around(side * (w / 2 - 0.3), 0.08),
      [0, 0.55],
      HUE.anthracite,
    );
  }
  const inner = w / 2 - 0.04;
  p.box([-l / 2, l / 2 - 0.04], around(0, inner), [deck, h], hue, 0.85);
  const ribs = Math.floor(l / 0.3);
  for (let i = 0; i < ribs; i++) {
    const rx = around(-l / 2 + 0.3 * (i + 0.5), 0.07);
    p.box(rx, [inner, w / 2], [deck + 0.1, h - 0.1], hue);
    p.box(rx, [-w / 2, -inner], [deck + 0.1, h - 0.1], hue);
  }
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const z of [deck, h - 0.16] as const) {
        const cx: Range = sx > 0 ? [l / 2 - 0.16, l / 2] : [-l / 2, -l / 2 + 0.16];
        const cy: Range = sy > 0 ? [w / 2 - 0.16, w / 2] : [-w / 2, -w / 2 + 0.16];
        p.box(cx, cy, [z, z + 0.16], HUE.anthracite);
      }
    }
  }
  for (const y of [-0.75, -0.25, 0.25, 0.75]) {
    p.box(
      [l / 2 - 0.04, l / 2],
      around(y * (w / 2.5), 0.025),
      [deck + 0.1, h - 0.1],
      HUE.anthracite,
    );
  }
  return { x: o.obb.cx, y: o.obb.cy, geometry: p.place(o.obb.cx, o.obb.cy, heading) };
}

/** Curtain-sider semitrailer: frame, strapped curtain, headboard, underrun bar, tandem-plus axles. */
function curtainSider(o: Obstacle, index: number): PropPiece {
  const { along: l, across: w, heading } = longFrame(o);
  const h = o.height;
  const hue = CURTAIN_HUES[index % CURTAIN_HUES.length] ?? HUE.whiteAluminium;
  const deck = 1.2;
  const p = new Parts();
  p.box([-l / 2, l / 2], around(0, w / 2 - 0.05), [0.95, deck], HUE.anthracite);
  p.box([-l / 2 + 0.04, l / 2 - 0.04], around(0, w / 2 - 0.05), [deck, h - 0.1], hue, 0.9);
  p.box([-l / 2, l / 2], around(0, w / 2), [h - 0.1, h], HUE.anthracite);
  p.box([-l / 2, -l / 2 + 0.04], around(0, w / 2 - 0.05), [deck, h - 0.1], HUE.anthracite);
  p.box([l / 2 - 0.04, l / 2], around(0, w / 2 - 0.05), [deck, h - 0.1], HUE.anthracite);
  for (let sx = -l / 2 + 0.6; sx < l / 2 - 0.3; sx += 1.2) {
    p.box(around(sx, 0.04), [w / 2 - 0.05, w / 2], [deck, h - 0.1], HUE.anthracite);
    p.box(around(sx, 0.04), [-w / 2, -w / 2 + 0.05], [deck, h - 0.1], HUE.anthracite);
  }
  p.box([l / 2 - 0.2, l / 2], around(0, w / 2 - 0.2), [0.5, 0.7], HUE.signalYellow);
  for (const side of [-1, 1]) {
    const y: Range = side > 0 ? [w / 2 - TYRE.width, w / 2] : [-w / 2, -w / 2 + TYRE.width];
    for (let axle = 0; axle < 3; axle++) {
      p.box(
        around(l / 2 - 1.4 - 1.3 * axle, TYRE.length / 2),
        y,
        [0, TYRE.height],
        HUE.chevronBlack,
      );
    }
    p.box(
      around(-l / 2 + 3.2, 0.08),
      around(side * (w / 2 - 0.4), 0.08),
      [0, 0.95],
      HUE.anthracite,
    );
  }
  return { x: o.obb.cx, y: o.obb.cy, geometry: p.place(o.obb.cx, o.obb.cy, heading) };
}

/** Mast with floodlights aimed at `aim`; low street lamps get a single arm luminaire. */
function lamp(o: Obstacle, aim: { x: number; y: number }): PropPiece {
  const { cx, cy, halfLength: hl, halfWidth: hw } = o.obb;
  const h = o.height;
  const p = new Parts();
  p.box(around(0, hl), around(0, hw), [0, 0.6], HUE.anthracite);
  p.box(around(0, hl * 0.55), around(0, hw * 0.55), [0.6, h - 0.1], HUE.whiteAluminium);
  if (h >= MAST_HEIGHT_MIN) {
    p.box(around(0.1, 0.1), around(0, 0.9), [h - 0.35, h - 0.2], HUE.anthracite);
    for (let i = 0; i < FLOODLIGHTS; i++) {
      const yc = (i - (FLOODLIGHTS - 1) / 2) * 0.6;
      p.box([0.05, 0.4], around(yc, 0.25), [h - 0.65, h - 0.35], HUE.anthracite);
      p.box([0.4, 0.43], around(yc, 0.22), [h - 0.62, h - 0.38], HUE.plateWhite);
    }
  } else {
    p.box([0, 1.2], around(0, 0.04), [h - 0.25, h - 0.15], HUE.whiteAluminium);
    p.box([0.8, 1.4], around(0, 0.15), [h - 0.3, h - 0.15], HUE.anthracite);
    p.box([0.85, 1.35], around(0, 0.12), [h - 0.32, h - 0.3], HUE.plateWhite);
  }
  const heading = Math.atan2(aim.y - cy, aim.x - cx);
  return { x: cx, y: cy, geometry: p.place(cx, cy, heading) };
}

function bollard(o: Obstacle): PropPiece {
  const { cx, cy, halfLength: hl, halfWidth: hw, heading } = o.obb;
  const h = o.height;
  const x = around(0, hl);
  const y = around(0, hw);
  const p = new Parts()
    .box(x, y, [0, h], HUE.signalYellow)
    .box(x, y, [h * 0.55, h * 0.7], HUE.chevronBlack)
    .box(x, y, [h - 0.05, h], HUE.chevronBlack);
  return { x: cx, y: cy, geometry: p.place(cx, cy, heading) };
}

/** Barrier post with a raised, striped boom pointing along the obstacle's +x. */
function barrier(o: Obstacle): PropPiece {
  const { cx, cy, halfLength: hl, halfWidth: hw, heading } = o.obb;
  const h = o.height;
  const p = new Parts()
    .box(around(0, hl), around(0, hw), [0, 0.15], HUE.anthracite)
    .box(around(0, hl), around(0, hw), [0.15, h], HUE.plateWhite)
    .box(around(0, hl), around(0, hw), [h * 0.55, h * 0.75], HUE.tailLamp);
  const stripes = Math.round(BOOM.length / BOOM.stripe);
  for (let i = 0; i < stripes; i++) {
    const arm = box([i * BOOM.stripe, (i + 1) * BOOM.stripe], around(0, BOOM.thickness / 2), [
      0,
      BOOM.thickness,
    ])
      .rotateZ(BOOM.lift)
      .translate(0, h, 0);
    p.add(arm, i % 2 === 0 ? HUE.plateWhite : HUE.tailLamp);
  }
  return { x: cx, y: cy, geometry: p.place(cx, cy, heading) };
}

/** Cabin with glazing towards the entrance (-x) and the street (-y). */
function gatehouse(o: Obstacle): PropPiece {
  const { cx, cy, halfLength: hl, halfWidth: hw, heading } = o.obb;
  const h = o.height;
  const eaves = h - 0.3;
  const p = new Parts()
    .box(around(0, hl), around(0, hw), [0, 0.4], HUE.anthracite)
    .box(around(0, hl - 0.03), around(0, hw - 0.03), [0.4, eaves], HUE.whiteAluminium)
    .box(around(0, hl), around(0, hw), [eaves, h], HUE.anthracite)
    .box([-hl, -hl + 0.06], around(0, hw - 0.4), [1, 2.2], HUE.chevronBlack)
    .box(around(0, hl - 0.4), [-hw, -hw + 0.06], [1, 2.2], HUE.chevronBlack);
  return { x: cx, y: cy, geometry: p.place(cx, cy, heading) };
}

export function yardProps(layout: ResolvedLayout): PropPiece[] {
  const aim = {
    x: (layout.yard.minX + layout.yard.maxX) / 2,
    y: (layout.yard.minY + layout.yard.maxY) / 2,
  };
  const out: PropPiece[] = [];
  let containers = 0;
  let trailers = 0;
  for (const o of layout.obstacles) {
    switch (o.kind) {
      case 'fence':
        out.push(...fence(o));
        break;
      case 'hall':
        out.push(...hallWall(o));
        break;
      case 'parked':
        out.push(
          longFrame(o).along >= TRAILER_MIN_LENGTH
            ? curtainSider(o, trailers++)
            : container(o, containers++),
        );
        break;
      case 'lamp':
        out.push(lamp(o, aim));
        break;
      case 'bollard':
        out.push(bollard(o));
        break;
      case 'barrier':
        out.push(barrier(o));
        break;
      case 'gatehouse':
        out.push(gatehouse(o));
        break;
      default:
        break;
    }
  }
  const halls = layout.obstacles.filter((o) => o.kind === 'hall');
  if (halls.length > 0) out.push(...hallDetail(layout, halls));
  return out;
}
