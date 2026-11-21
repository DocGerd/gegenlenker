import { BufferGeometry, CylinderGeometry, Float32BufferAttribute, PlaneGeometry } from 'three';
import { REALISM_HUES as HUE } from './realism-hues';
import { box } from './vehicle-geometry';
import type { Parts, Range } from './yard-props';

/*
 * Perspective-only precast concrete, loading-ramp and cone detail in a local frame (x along, y across,
 * z up) centred on the obstacle. Every body fills the obstacle's footprint; only joint strips stand
 * proud of it, by `OVERLAY`.
 */

export const OVERLAY = 0.005; // joints stand this far proud of the body, so no faces are coplanar
const JOINT = 0.45; // joint shade against the stone
const STONE_SHADES = [0.94, 1, 1.06, 0.98] as const;
const KERB = { stone: 1, joint: 0.016 };
const WALL = { element: 2.5, joint: 0.024 };
const RAMP = { joint: 4, leg: 0.012, flange: 0.12, web: 0.12, inset: 0.004, stripe: 0.02 };
const CONE = { base: 0.035, sides: 12, neck: 0.04, fill: 0.85 };
const CONE_BANDS: readonly (readonly [number, number, boolean])[] = [
  [0, 0.38, false],
  [0.38, 0.5, true],
  [0.5, 0.62, false],
  [0.62, 0.8, true],
  [0.8, 1, false],
];

/** `BoxGeometry` face order, four vertices each. */
const FACE = { right: 0, left: 1, top: 2, bottom: 3 } as const;

const around = (centre: number, half: number): Range => [centre - half, centre + half];
const stoneShade = (i: number): number => STONE_SHADES[i % STONE_SHADES.length] ?? 1;

/** A box without the faces that nothing can see: the underside and the ends against a neighbour. */
function solid(x: Range, y: Range, z: Range, hidden: readonly number[]): BufferGeometry {
  const source = box(x, y, z);
  const position = source.getAttribute('position');
  const normal = source.getAttribute('normal');
  const index = source.getIndex();
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let kept = 0;
  for (let face = 0; face < 6; face++) {
    if (hidden.includes(face)) continue;
    for (let v = face * 4; v < face * 4 + 4; v++) {
      positions.push(position.getX(v), position.getY(v), position.getZ(v));
      normals.push(normal.getX(v), normal.getY(v), normal.getZ(v));
    }
    for (let i = face * 6; i < face * 6 + 6; i++) {
      indices.push((index?.getX(i) ?? 0) - face * 4 + kept * 4);
    }
    kept++;
  }
  source.dispose();
  return new BufferGeometry()
    .setAttribute('position', new Float32BufferAttribute(positions, 3))
    .setAttribute('normal', new Float32BufferAttribute(normals, 3))
    .setIndex(indices);
}

/** A flat strip on top of a body, `OVERLAY` above `z`. */
function topStrip(x: Range, y: Range, z: number): BufferGeometry {
  return new PlaneGeometry(x[1] - x[0], y[1] - y[0])
    .rotateX(-Math.PI / 2)
    .translate((x[0] + x[1]) / 2, z + OVERLAY, -(y[0] + y[1]) / 2);
}

/** A flat strip on a long face of a body, `OVERLAY` off it; `side` 1 is the left (+y) face. */
function faceStrip(x: Range, edge: number, side: 1 | -1, z: Range): BufferGeometry {
  const plane = new PlaneGeometry(x[1] - x[0], z[1] - z[0]);
  if (side > 0) plane.rotateY(Math.PI);
  return plane.translate((x[0] + x[1]) / 2, (z[0] + z[1]) / 2, -side * (edge + OVERLAY));
}

/** Kerbstones one metre long, each a touch lighter or darker, with a dark joint on top between them. */
export function kerb(
  p: Parts,
  length: number,
  across: number,
  height: number,
  offset: number,
): void {
  const n = length < 2 * KERB.stone ? 1 : Math.round(length / KERB.stone);
  const step = length / n;
  const first = Math.round(offset / KERB.stone);
  const y = around(0, across / 2);
  for (let i = 0; i < n; i++) {
    const x0 = -length / 2 + step * i;
    const hidden = [FACE.bottom, ...(i > 0 ? [FACE.left] : []), ...(i < n - 1 ? [FACE.right] : [])];
    // A single stone has no rhythm: the short segments of an arc overlap, so they share one shade.
    p.add(
      solid([x0, x0 + step], y, [0, height], hidden),
      HUE.concrete,
      n === 1 ? 1 : stoneShade(first + i),
    );
    if (i > 0) p.add(topStrip(around(x0, KERB.joint / 2), y, height), HUE.concrete, JOINT);
  }
}

/** Precast wall elements with a dark joint on both faces and the top between elements. */
export function concreteWall(
  p: Parts,
  length: number,
  across: number,
  height: number,
  offset: number,
): void {
  const n = Math.max(1, Math.round(length / WALL.element));
  const step = length / n;
  const first = Math.round(offset / WALL.element);
  const y = around(0, across / 2);
  for (let i = 0; i < n; i++) {
    const x0 = -length / 2 + step * i;
    const hidden = [FACE.bottom, ...(i > 0 ? [FACE.left] : []), ...(i < n - 1 ? [FACE.right] : [])];
    p.add(solid([x0, x0 + step], y, [0, height], hidden), HUE.concrete, stoneShade(first + i));
    if (i > 0) {
      const x = around(x0, WALL.joint / 2);
      p.add(topStrip(x, y, height), HUE.concrete, JOINT);
      for (const side of [-1, 1] as const) {
        p.add(faceStrip(x, across / 2, side, [0, height]), HUE.concrete, JOINT);
      }
    }
  }
}

/** Concrete loading ramp: deck with expansion joints and a steel edge angle along both long edges. */
export function loadingRamp(p: Parts, length: number, across: number, height: number): void {
  const flange = Math.min(RAMP.flange, across / 4);
  const leg = Math.min(RAMP.leg, height / 4);
  const web = Math.min(RAMP.web, height / 2);
  const inset = Math.min(RAMP.inset, length / 4);
  const x: Range = [-length / 2, length / 2];
  const deckTop = height - leg;
  const inner = around(0, across / 2 - flange);
  p.add(solid(x, around(0, across / 2), [0, deckTop], [FACE.bottom]), HUE.concrete, 0.88);
  p.add(solid(x, inner, [deckTop, height], [FACE.bottom]), HUE.concrete, 1.05);
  const joints = Math.max(1, Math.round(length / RAMP.joint));
  for (let i = 1; i < joints; i++) {
    const at = -length / 2 + (length * i) / joints;
    p.add(topStrip(around(at, RAMP.stripe / 2), inner, height), HUE.concrete, JOINT);
  }
  const angle: Range = [-length / 2 + inset, length / 2 - inset];
  for (const side of [-1, 1]) {
    const edge = side * (across / 2);
    const flat: Range =
      side > 0 ? [edge - flange, edge + OVERLAY] : [edge - OVERLAY, edge + flange];
    const upright: Range = side > 0 ? [edge - leg, edge + OVERLAY] : [edge - OVERLAY, edge + leg];
    p.add(solid(angle, flat, [deckTop, height], [FACE.bottom]), HUE.anthracite, 1.2);
    p.add(solid(angle, upright, [height - web, height], [FACE.bottom]), HUE.anthracite, 1.2);
  }
}

/** Traffic cone: black square base, red body with two white reflective bands. */
export function trafficCone(p: Parts, halfLength: number, halfWidth: number, height: number): void {
  const { sides, neck, fill } = CONE;
  const base = Math.min(CONE.base, height / 2);
  p.add(
    solid(around(0, halfLength), around(0, halfWidth), [0, base], [FACE.bottom]),
    HUE.chevronBlack,
  );
  const bottom = Math.min(halfLength, halfWidth) * fill;
  const top = Math.min(neck, bottom);
  const rise = height - base;
  const radius = (t: number): number => bottom + (top - bottom) * t;
  for (const [i, [from, to, band]] of CONE_BANDS.entries()) {
    const g = new CylinderGeometry(
      radius(to),
      radius(from),
      rise * (to - from),
      sides,
      1,
      i < CONE_BANDS.length - 1,
    );
    g.translate(0, base + rise * ((from + to) / 2), 0);
    p.add(g, band ? HUE.plateWhite : HUE.coneRed, 1, band ? 1 : 0);
  }
}
