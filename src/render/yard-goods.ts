import { type BufferGeometry, CylinderGeometry } from 'three';
import { REALISM_HUES as HUE } from './realism-hues';
import { box } from './vehicle-geometry';
import type { Parts, Range } from './yard-props';

/*
 * Perspective-only loose goods and street furniture, built in a local frame (x forward, y left, z up)
 * around `at`. Decoration only: callers place it on a ramp top, outside the yard edge, or on an
 * existing obstacle, never on drivable ground.
 */

export type At = { readonly x: number; readonly y: number; readonly z: number };

const around = (centre: number, half: number): Range => [centre - half, centre + half];
const shift = (r: Range, d: number): Range => [r[0] + d, r[1] + d];
const WOOD = HUE.containerOrange;
const WOOD_SHADE = 0.55;
const ZINC = HUE.whiteAluminium;

const PALLET = { length: 1.2, width: 0.8, height: 0.144 };
const MESH_BOX = { length: 1.24, width: 0.84, height: 0.97, foot: 0.15, barPitch: 0.15 };
const SKIP = { length: 3.4, width: 1.7, height: 1.2, floor: 0.16, wall: 0.04 };
const OVERLAY = 0.005; // castings stand this far proud of the body, so no faces are coplanar
const SWAP = { leg: 0.08, legHeight: 1, ribPitch: 1.1 };

/** Wood pallet: three runners under five deck boards. */
export function pallet(p: Parts, at: At): void {
  const { length: l, width: w, height: h } = PALLET;
  const bx = (x: Range, y: Range, z: Range): void => {
    p.box(shift(x, at.x), shift(y, at.y), shift(z, at.z), WOOD, WOOD_SHADE);
  };
  for (const y of [-w / 2 + 0.07, 0, w / 2 - 0.07])
    bx([-l / 2, l / 2], [y - 0.07, y + 0.07], [0, 0.1]);
  for (let i = 0; i < 5; i++) {
    const x = -l / 2 + 0.07 + ((l - 0.14) * i) / 4;
    bx([x - 0.07, x + 0.07], [-w / 2, w / 2], [0.1, h]);
  }
}

/** Stack of `count` empty pallets, or one pallet carrying a wrapped load of `load` metres. */
export function palletStack(p: Parts, at: At, count: number, load = 0): void {
  for (let i = 0; i < count; i++) pallet(p, { ...at, z: at.z + i * PALLET.height });
  if (load <= 0) return;
  const top = at.z + PALLET.height;
  const [l, w] = [PALLET.length - 0.1, PALLET.width - 0.1];
  p.box(
    [at.x - l / 2, at.x + l / 2],
    [at.y - w / 2, at.y + w / 2],
    [top, top + load],
    HUE.plateWhite,
    0.85,
  );
  p.box(
    [at.x - l / 2 - 0.01, at.x + l / 2 + 0.01],
    [at.y - w / 2 - 0.01, at.y + w / 2 + 0.01],
    [top + load * 0.45, top + load * 0.5],
    HUE.chevronBlack,
  );
}

/** Gitterbox: zinc frame with a thin vertical bar grid, see-through; optionally loaded. */
export function meshBox(p: Parts, at: At, loaded = false): void {
  const { length: l, width: w, height: h, foot, barPitch } = MESH_BOX;
  const bx = (x: Range, y: Range, z: Range, shade = 1): void => {
    p.box(shift(x, at.x), shift(y, at.y), shift(z, at.z), ZINC, shade);
  };
  const post = 0.04;
  for (const sx of [-1, 1]) {
    bx(
      [sx * (l / 2 - post / 2) - post / 2, sx * (l / 2 - post / 2) + post / 2],
      [-w / 2, w / 2],
      [0, foot],
      0.8,
    );
    for (const sy of [-1, 1]) {
      const x: Range = sx > 0 ? [l / 2 - post, l / 2] : [-l / 2, -l / 2 + post];
      const y: Range = sy > 0 ? [w / 2 - post, w / 2] : [-w / 2, -w / 2 + post];
      bx(x, y, [foot, h], 1.1);
    }
  }
  for (const z of [foot, h - 0.04] as const) {
    bx([-l / 2, l / 2], [-w / 2, -w / 2 + post], [z, z + post], 1.1);
    bx([-l / 2, l / 2], [w / 2 - post, w / 2], [z, z + post], 1.1);
    bx([-l / 2, -l / 2 + post], [-w / 2, w / 2], [z, z + post], 1.1);
    bx([l / 2 - post, l / 2], [-w / 2, w / 2], [z, z + post], 1.1);
  }
  const bars = (len: number, fixed: number, alongX: boolean): void => {
    const n = Math.floor(len / barPitch);
    for (let i = 1; i < n; i++) {
      const c = -len / 2 + (len * i) / n;
      const a: Range = [c - 0.008, c + 0.008];
      const b: Range = [fixed - 0.008, fixed + 0.008];
      if (alongX) bx(a, b, [foot + post, h - 0.04], 0.9);
      else bx(b, a, [foot + post, h - 0.04], 0.9);
    }
  };
  for (const s of [-1, 1]) {
    bars(l, s * (w / 2 - 0.01), true);
    bars(w, s * (l / 2 - 0.01), false);
  }
  if (loaded) {
    bx([-l / 2 + 0.1, l / 2 - 0.1], [-w / 2 + 0.1, w / 2 - 0.1], [foot + post, h * 0.7], 0.65);
  }
}

/** Widens a plate from its base (y = 0) to `ratio` times its width along `axis` at `height`, so plates meet at the rim. */
function taper(g: BufferGeometry, axis: 'x' | 'z', ratio: number, height: number): BufferGeometry {
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const k = 1 + (ratio - 1) * (pos.getY(i) / height);
    if (axis === 'x') pos.setX(i, pos.getX(i) * k);
    else pos.setZ(i, pos.getZ(i) * k);
  }
  return g;
}

/** Open skip (Absetzmulde): sloped plate walls on skids, rim and a heap of spoil. */
export function skip(p: Parts, at: At, hue: number): void {
  const { length: l, width: w, height: h, floor, wall } = SKIP;
  const flat = (x: Range, y: Range, z: Range, c: number, shade = 1): void => {
    p.box(shift(x, at.x), shift(y, at.y), shift(z, at.z), c, shade);
  };
  const base = 0.55;
  const rise = h - floor;
  const lean = Math.atan2(w / 2 - base, rise);
  const slant = rise / Math.cos(lean);
  const sideLength = l - 0.5;
  flat([-l / 2 + 0.25, l / 2 - 0.25], [-base, base], [0.1, floor], hue, 0.7);
  for (const y of [-0.45, 0.45]) flat([-l / 2, l / 2], around(y, 0.06), [0, 0.1], HUE.anthracite);
  for (const side of [-1, 1]) {
    const plate = taper(
      box([-sideLength / 2, sideLength / 2], [-wall / 2, wall / 2], [0, slant]),
      'x',
      l / sideLength,
      slant,
    )
      .rotateX(-side * lean)
      .translate(at.x, at.z + floor, -(at.y + side * base));
    p.add(plate, hue);
    flat(
      [-l / 2 + 0.2, l / 2 - 0.2],
      around(side * (w / 2 - 0.02), 0.03),
      [h - 0.06, h],
      HUE.anthracite,
    );
  }
  const endLean = Math.atan2(0.25, rise);
  const endSlant = rise / Math.cos(endLean);
  for (const end of [-1, 1]) {
    const plate = taper(
      box([-wall / 2, wall / 2], [-base, base], [0, endSlant]),
      'z',
      w / 2 / base,
      endSlant,
    )
      .rotateZ(-end * endLean)
      .translate(at.x + end * (l / 2 - 0.25), at.z + floor, -at.y);
    p.add(plate, hue, 0.9);
  }
  flat([-1.2, 1.2], [-0.55, 0.55], [floor, 0.5], HUE.anthracite, 1.4);
  flat([-0.7, 0.7], [-0.4, 0.4], [0.5, 0.65], HUE.anthracite, 1.2);
}

/** Swap body on four support legs: smooth box, frame ribs, corner castings, door bars. */
export function swapBody(
  p: Parts,
  at: At,
  length: number,
  width: number,
  top: number,
  hue: number,
): void {
  const { leg, legHeight, ribPitch } = SWAP;
  const bx = (x: Range, y: Range, z: Range, c: number, shade = 1): void => {
    p.box(shift(x, at.x), shift(y, at.y), shift(z, at.z), c, shade);
  };
  const [l, w] = [length, width];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const cx = sx * (l / 2 - 0.9);
      const cy = sy * (w / 2 - 0.15);
      bx(around(cx, leg), around(cy, leg), [0.04, legHeight], HUE.anthracite);
      bx(around(cx, 0.15), around(cy, 0.15), [0, 0.04], HUE.chevronBlack);
    }
  }
  for (const y of [-(w / 2 - 0.3), w / 2 - 0.3]) {
    bx([-l / 2, l / 2], around(y, 0.08), [legHeight - 0.12, legHeight], HUE.anthracite);
  }
  const bodyTop = top;
  bx([-l / 2, l / 2], [-w / 2, w / 2], [legHeight, bodyTop], hue, 0.9);
  const ribs = Math.floor(l / ribPitch);
  for (let i = 0; i < ribs; i++) {
    const x = around(-l / 2 + ribPitch * (i + 0.5), 0.04);
    bx(x, [w / 2, w / 2 + 0.02], [legHeight + 0.08, bodyTop - 0.08], hue, 1.15);
    bx(x, [-w / 2 - 0.02, -w / 2], [legHeight + 0.08, bodyTop - 0.08], hue, 1.15);
  }
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const z of [legHeight, bodyTop - 0.16] as const) {
        const x: Range =
          sx > 0 ? [l / 2 - 0.16, l / 2 + OVERLAY] : [-l / 2 - OVERLAY, -l / 2 + 0.16];
        const y: Range =
          sy > 0 ? [w / 2 - 0.16, w / 2 + OVERLAY] : [-w / 2 - OVERLAY, -w / 2 + 0.16];
        bx(x, y, [z - OVERLAY, z + 0.16 + OVERLAY], HUE.anthracite);
      }
    }
  }
  for (const y of [-0.6, -0.2, 0.2, 0.6]) {
    bx(
      [l / 2, l / 2 + 0.03],
      around(y * (w / 2 / 0.75), 0.025),
      [legHeight + 0.1, bodyTop - 0.1],
      HUE.anthracite,
    );
  }
}

/** U-bar impact hoop between two post positions on an axis-parallel line. */
export function hoopRail(
  p: Parts,
  a: readonly [number, number],
  b: readonly [number, number],
  height = 1,
): void {
  const t = 0.04;
  const x: Range = [Math.min(a[0], b[0]) - t, Math.max(a[0], b[0]) + t];
  const y: Range = [Math.min(a[1], b[1]) - t, Math.max(a[1], b[1]) + t];
  p.box(x, y, [height - 0.1, height], HUE.signalYellow);
  p.box(x, y, [height * 0.45, height * 0.45 + 0.1], HUE.chevronBlack);
}

export function hoopPost(p: Parts, at: readonly [number, number], height = 1): void {
  p.box(around(at[0], 0.04), around(at[1], 0.04), [0, height], HUE.signalYellow);
  p.box(
    around(at[0], 0.045),
    around(at[1], 0.045),
    [height * 0.45, height * 0.45 + 0.1],
    HUE.chevronBlack,
  );
}

/** Convex traffic mirror on a short pole, its face turned to `facing` (sim heading, radians). */
export function trafficMirror(p: Parts, at: At, facing: number): void {
  const pole = 1.3;
  const r = 0.4;
  p.box(around(at.x, 0.04), around(at.y, 0.04), [at.z, at.z + pole], HUE.anthracite);
  const disc = (
    radius: number,
    thickness: number,
    hue: number,
    offset: number,
    shade = 1,
  ): void => {
    const g = new CylinderGeometry(radius, radius, thickness, 14).rotateZ(Math.PI / 2);
    g.rotateY(facing).translate(
      at.x + Math.cos(facing) * offset,
      at.z + pole + r,
      -(at.y + Math.sin(facing) * offset),
    );
    p.add(g, hue, shade);
  };
  disc(r, 0.04, HUE.tailLamp, 0.06);
  disc(r - 0.05, 0.04, HUE.skyHaze, 0.09, 0.9);
}
