import { CylinderGeometry } from 'three';
import { REALISM_HUES as HUE } from './realism-hues';
import type { Parts, Range } from './yard-props';

/*
 * Perspective-only precast concrete, loading-ramp and cone detail in a local frame (x along, y across,
 * z up) centred on the obstacle. Every body fills the obstacle's footprint; only joint strips stand
 * proud of it, by `OVERLAY`.
 */

const OVERLAY = 0.005; // joints stand this far proud of the body, so no faces are coplanar
const JOINT = 0.45; // joint shade against the stone
const STONE_SHADES = [0.94, 1, 1.06, 0.98] as const;
const KERB_STONE = 1;
const WALL = { element: 2.5, foot: 0.4, coping: 0.15, joint: 0.012 };
const RAMP = { joint: 4, leg: 0.012, flange: 0.12, web: 0.12, inset: 0.004 };
const CONE = { base: 0.035, sides: 12, neck: 0.04, fill: 0.85 };
const CONE_BANDS: readonly (readonly [number, number, boolean])[] = [
  [0, 0.38, false],
  [0.38, 0.5, true],
  [0.5, 0.62, false],
  [0.62, 0.8, true],
  [0.8, 1, false],
];

const around = (centre: number, half: number): Range => [centre - half, centre + half];
const stoneShade = (i: number): number => STONE_SHADES[i % STONE_SHADES.length] ?? 1;

/** Kerbstones one metre long, each a touch lighter or darker, with a dark joint between. */
export function kerb(p: Parts, length: number, across: number, height: number): void {
  const n = Math.max(1, Math.round(length / KERB_STONE));
  const step = length / n;
  for (let i = 0; i < n; i++) {
    const x0 = -length / 2 + step * i;
    p.box([x0, x0 + step], around(0, across / 2), [0, height], HUE.concrete, stoneShade(i));
    if (i > 0) {
      p.box(
        around(x0, 0.008),
        around(0, across / 2 + OVERLAY),
        [0, height + OVERLAY],
        HUE.concrete,
        JOINT,
      );
    }
  }
}

/** Precast wall elements with a foot, a coping and a dark joint between elements. */
export function concreteWall(p: Parts, length: number, across: number, height: number): void {
  const { element, foot, coping, joint } = WALL;
  const n = Math.max(1, Math.round(length / element));
  const step = length / n;
  const y = around(0, across / 2);
  for (let i = 0; i < n; i++) {
    const x: Range = [-length / 2 + step * i, -length / 2 + step * (i + 1)];
    const shade = stoneShade(i);
    p.box(x, y, [0, foot], HUE.concrete, shade * 0.85);
    p.box(x, y, [foot, height - coping], HUE.concrete, shade);
    p.box(x, y, [height - coping, height], HUE.concrete, shade * 1.1);
    if (i > 0) {
      p.box(
        around(x[0], joint / 2),
        around(0, across / 2 + OVERLAY),
        [0, height + OVERLAY],
        HUE.concrete,
        JOINT,
      );
    }
  }
}

/** Concrete loading ramp: deck with expansion joints and a steel edge angle along both long edges. */
export function loadingRamp(p: Parts, length: number, across: number, height: number): void {
  const { joint, leg, flange, web, inset } = RAMP;
  const x: Range = [-length / 2, length / 2];
  const deckTop = height - leg;
  p.box(x, around(0, across / 2), [0, deckTop], HUE.concrete, 0.88);
  p.box(x, around(0, across / 2 - flange), [deckTop, height], HUE.concrete, 1.05);
  const joints = Math.max(1, Math.round(length / joint));
  for (let i = 1; i < joints; i++) {
    p.box(
      around(-length / 2 + (length * i) / joints, 0.01),
      around(0, across / 2 - flange),
      [deckTop + leg / 2, height + OVERLAY],
      HUE.concrete,
      JOINT,
    );
  }
  const angle: Range = [-length / 2 + inset, length / 2 - inset];
  for (const side of [-1, 1]) {
    const edge = side * (across / 2);
    const flat: Range =
      side > 0 ? [edge - flange, edge + OVERLAY] : [edge - OVERLAY, edge + flange];
    const upright: Range = side > 0 ? [edge - leg, edge + OVERLAY] : [edge - OVERLAY, edge + leg];
    p.box(angle, flat, [deckTop, height], HUE.anthracite, 1.2);
    p.box(angle, upright, [height - web, height], HUE.anthracite, 1.2);
  }
}

/** Traffic cone: black square base, orange body with two white reflective bands. */
export function trafficCone(p: Parts, halfLength: number, halfWidth: number, height: number): void {
  const { base, sides, neck, fill } = CONE;
  p.box(around(0, halfLength), around(0, halfWidth), [0, base], HUE.chevronBlack);
  const bottom = Math.min(halfLength, halfWidth) * fill;
  const rise = height - base;
  const radius = (t: number): number => bottom + (neck - bottom) * t;
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
    p.add(g, band ? HUE.plateWhite : HUE.coneOrange);
  }
}
