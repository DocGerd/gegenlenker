import { CanvasTexture, Color, SRGBColorSpace } from 'three';
import { REALISM_HUES as HUE } from './realism-hues';
import { rng } from './skyline-layout';

/*
 * One small atlas of facade cells. A cell is one window bay, one panel or one roof strip; the
 * geometry cuts every face into cells and maps each whole, so nothing relies on texture wrapping.
 * Every cell ends in a border of its own base colour, so mip levels that blend neighbours stay quiet.
 */

export const CELL = 64;
export const GRID = 8;
export const ATLAS_SIZE = CELL * GRID;
const INSET = 1.5 / ATLAS_SIZE;

type Scheme = 'L' | 'D';
type Glass = 'glassDark' | 'glassMid' | 'glassSky' | 'glassBlind';
const SCHEMES: readonly Scheme[] = ['L', 'D'];
const GLASS: readonly Glass[] = ['glassDark', 'glassMid', 'glassSky', 'glassBlind'];

const PLAIN = [
  'plainLight',
  'plainMid',
  'plainDark',
  'ribLight',
  'ribMid',
  'ribDark',
  'bandedLight',
  'bandedDark',
  'roofFlat',
  'roofSkylights',
  'roofSeamLight',
  'roofSeamDark',
  'glazing',
  'steel',
  'stripeWhite',
  'stripeRed',
  'foliage',
] as const;

/** The window's glass inside its frame, in cell pixels: what the drawing fills and the night glow masks. */
export const GLASS_RECT = { x0: 8, y0: 9, x1: 56, y1: 55 } as const;

export type Tile = `${Glass}${Scheme}` | `fascia${Scheme}` | (typeof PLAIN)[number];

export const TILES: readonly Tile[] = [
  ...SCHEMES.flatMap((s) => GLASS.map((g): Tile => `${g}${s}`)),
  ...SCHEMES.map((s): Tile => `fascia${s}`),
  ...PLAIN,
];

export const isGlassTile = (tile: Tile): boolean => GLASS.some((g) => tile.startsWith(g));

export type TileUv = {
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
};

/** Texture rectangle of a cell, inset so filtering never reads the neighbour. */
export function tileUv(tile: Tile): TileUv {
  const i = TILES.indexOf(tile);
  const col = i % GRID;
  const row = Math.floor(i / GRID);
  return {
    u0: col / GRID + INSET,
    u1: (col + 1) / GRID - INSET,
    v0: 1 - (row + 1) / GRID + INSET,
    v1: 1 - row / GRID - INSET,
  };
}

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/** Mix of two hues as hex; `Color` works in linear space, so `t` is a linear mix. */
function mix(a: number, b: number, t: number): string {
  const c = new Color(a).lerp(new Color(b), t);
  return `#${c.getHexString()}`;
}

/** Scales the linear colour by `f`, so it is not a perceptual lightness step. */
function shade(a: number, f: number): string {
  const c = new Color(a);
  c.multiplyScalar(f);
  return `#${c.getHexString()}`;
}

type Ctx = CanvasRenderingContext2D;

function rect(ctx: Ctx, color: string, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

const frameOf = (s: Scheme): string =>
  s === 'L' ? hex(HUE.whiteAluminium) : shade(HUE.anthracite, 1.5);

function glassOf(kind: Glass): string {
  switch (kind) {
    case 'glassDark':
      return mix(HUE.anthracite, HUE.skylineDark, 0.35);
    case 'glassMid':
      return hex(HUE.skylineDark);
    case 'glassSky':
      return mix(HUE.skylineDark, HUE.skyHaze, 0.6);
    case 'glassBlind':
      return mix(HUE.skylineDark, HUE.skyHaze, 0.25);
  }
}

function window(ctx: Ctx, scheme: Scheme, kind: Glass): void {
  rect(ctx, frameOf(scheme), 0, 0, CELL, CELL);
  rect(
    ctx,
    glassOf(kind),
    GLASS_RECT.x0,
    GLASS_RECT.y0,
    GLASS_RECT.x1 - GLASS_RECT.x0,
    GLASS_RECT.y1 - GLASS_RECT.y0,
  );
  if (kind === 'glassBlind') rect(ctx, hex(HUE.whiteAluminium), 8, 33, CELL - 16, CELL - 42);
  rect(ctx, shade(HUE.anthracite, 1.2), CELL / 2 - 1, 9, 2, CELL - 18);
  rect(ctx, hex(HUE.plateWhite), 8, CELL - 9, CELL - 16, 2);
}

function ribs(ctx: Ctx, base: number): void {
  const pitch = CELL / 8;
  rect(ctx, hex(base), 0, 0, CELL, CELL);
  for (let i = 0; i < 8; i++) {
    rect(ctx, shade(base, 1.18), i * pitch, 0, 2, CELL);
    rect(ctx, shade(base, 0.72), i * pitch + pitch - 3, 0, 3, CELL);
  }
}

function banded(ctx: Ctx, base: number): void {
  rect(ctx, hex(base), 0, 0, CELL, CELL);
  rect(ctx, shade(base, 0.75), 0, 28, CELL, 36);
  rect(ctx, shade(base, 1.2), 0, 26, CELL, 2);
  rect(ctx, shade(base, 0.6), 0, 60, CELL, 4);
  rect(ctx, shade(base, 0.82), CELL / 2 - 1, 0, 2, CELL);
}

function foliage(ctx: Ctx): void {
  const next = rng(11);
  const base = HUE.containerGreen;
  rect(ctx, shade(base, 0.55), 0, 0, CELL, CELL);
  for (let i = 0; i < 90; i++) {
    const x = next() * CELL;
    const y = next() * CELL;
    rect(ctx, shade(base, 0.4 + next() * 0.5), x, y, 4 + next() * 5, 4 + next() * 5);
  }
}

function draw(ctx: Ctx, tile: Tile): void {
  const glass = GLASS.find((g) => tile.startsWith(g));
  if (glass !== undefined) {
    window(ctx, tile.endsWith('D') ? 'D' : 'L', glass);
    return;
  }
  switch (tile) {
    case 'fasciaL':
      rect(ctx, hex(HUE.whiteAluminium), 0, 0, CELL, CELL);
      rect(ctx, shade(HUE.whiteAluminium, 0.6), 0, 44, CELL, 20);
      rect(ctx, hex(HUE.plateWhite), 0, 40, CELL, 4);
      return;
    case 'fasciaD':
      rect(ctx, hex(HUE.anthracite), 0, 0, CELL, CELL);
      rect(ctx, shade(HUE.anthracite, 1.8), 0, 10, CELL, 6);
      rect(ctx, shade(HUE.anthracite, 0.7), 0, 48, CELL, 16);
      return;
    case 'plainLight':
      rect(ctx, hex(HUE.whiteAluminium), 0, 0, CELL, CELL);
      return;
    case 'plainMid':
      rect(ctx, hex(HUE.skylineDark), 0, 0, CELL, CELL);
      return;
    case 'plainDark':
      rect(ctx, shade(HUE.anthracite, 1.3), 0, 0, CELL, CELL);
      return;
    case 'ribLight':
      ribs(ctx, HUE.whiteAluminium);
      return;
    case 'ribMid':
      ribs(ctx, HUE.skylineDark);
      return;
    case 'ribDark':
      ribs(ctx, new Color(HUE.anthracite).multiplyScalar(1.3).getHex());
      return;
    case 'bandedLight':
      banded(ctx, HUE.whiteAluminium);
      return;
    case 'bandedDark':
      banded(ctx, HUE.skylineDark);
      return;
    case 'roofFlat':
    case 'roofSkylights': {
      const roof = mix(HUE.whiteAluminium, HUE.anthracite, 0.35);
      rect(ctx, roof, 0, 0, CELL, CELL);
      rect(ctx, shade(HUE.anthracite, 1.4), 0, 31, CELL, 2);
      if (tile === 'roofSkylights') {
        rect(ctx, hex(HUE.skylineDark), 10, 8, 20, 16);
        rect(ctx, hex(HUE.skylineDark), 36, 8, 20, 16);
        rect(ctx, hex(HUE.skylineDark), 10, 40, 20, 16);
        rect(ctx, hex(HUE.skylineDark), 36, 40, 20, 16);
      }
      return;
    }
    case 'roofSeamLight':
    case 'roofSeamDark': {
      const base = tile === 'roofSeamLight' ? HUE.whiteAluminium : HUE.skylineDark;
      rect(ctx, shade(base, 0.85), 0, 0, CELL, CELL);
      for (let x = 0; x < CELL; x += 8) rect(ctx, shade(base, 1.2), x, 0, 2, CELL);
      return;
    }
    case 'glazing':
      rect(ctx, hex(HUE.anthracite), 0, 0, CELL, CELL);
      rect(ctx, mix(HUE.skylineDark, HUE.skyHaze, 0.5), 3, 6, CELL - 6, CELL - 12);
      for (const x of [16, 32, 48]) rect(ctx, hex(HUE.anthracite), x - 1, 0, 2, CELL);
      return;
    case 'steel':
      rect(ctx, shade(HUE.skylineDark, 0.9), 0, 0, CELL, CELL);
      for (let i = -CELL; i < CELL; i += 12) {
        ctx.strokeStyle = shade(HUE.anthracite, 1.4);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + CELL, CELL);
        ctx.stroke();
      }
      return;
    case 'stripeWhite':
      rect(ctx, hex(HUE.plateWhite), 0, 0, CELL, CELL);
      return;
    case 'stripeRed':
      rect(ctx, hex(HUE.containerRed), 0, 0, CELL, CELL);
      return;
    case 'foliage':
      foliage(ctx);
      return;
  }
}

/** The atlas, or null where there is no canvas (tests, workers). */
export function createAtlasTexture(): CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_SIZE;
  canvas.height = ATLAS_SIZE;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  TILES.forEach((tile, i) => {
    ctx.save();
    ctx.translate((i % GRID) * CELL, Math.floor(i / GRID) * CELL);
    ctx.beginPath();
    ctx.rect(0, 0, CELL, CELL);
    ctx.clip();
    draw(ctx, tile);
    ctx.restore();
  });
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}
