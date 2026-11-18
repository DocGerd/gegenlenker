import {
  GROUND_CHANNELS,
  GROUND_TEXTURE_MEAN,
  GROUND_TEXTURE_SIZE,
  type GroundMaterial,
} from '../../src/render/ground-texture-pixels';
import { fbm, hash, ridge, smoothstep } from './noise';

/*
 * The ground detail map, authored from seeded noise: concrete slabs, asphalt and pavers in the R, G
 * and B channels of one seamless tile, each with its own wear. Linear values, mean GROUND_TEXTURE_MEAN.
 */

const SEED = 6903;
const SIZE = GROUND_TEXTURE_SIZE;

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** Distance in pixels to the nearest multiple of `step`, on a periodic axis. */
const toLine = (p: number, step: number): number => {
  const r = ((p % step) + step) % step;
  return Math.min(r, step - r);
};

type Field = (u: number, v: number, x: number, y: number) => number;

/** Hairline crack segments: the zero set of a ridge noise, kept only where a second noise allows. */
const cracks = (u: number, v: number, seed: number): number =>
  smoothstep(0.984, 0.998, ridge(u, v, 6, 3, seed)) *
  smoothstep(0.6, 0.68, fbm(u, v, 3, 2, seed + 1));

/** Saw-cut slabs with aggregate grain, pores, mottling, oil stains and hairline cracks. */
const concrete: Field = (u, v, x, y) => {
  const slabs = 2;
  const slabX = Math.floor((x * slabs) / SIZE);
  const slabY = Math.floor((y * slabs) / SIZE);
  const slabTone = (hash(slabX, slabY, SEED + 1) - 0.5) * 0.06;
  const mottle = (fbm(u, v, 4, 5, SEED + 2) - 0.5) * 0.14;
  const grain = (fbm(u, v, 128, 3, SEED + 3, 0.6) - 0.5) * 0.1;
  const speck = hash(x, y, SEED + 4);
  const pores = speck < 0.01 ? -0.14 : speck > 0.996 ? 0.06 : 0;

  // joints wobble by a few pixels so they are not ruled lines
  const wobbleX = (fbm(u, v, 16, 2, SEED + 5) - 0.5) * 10;
  const wobbleY = (fbm(u, v, 16, 2, SEED + 6) - 0.5) * 10;
  const joint = Math.min(toLine(x + wobbleY, SIZE / slabs), toLine(y + wobbleX, SIZE / slabs));
  const cut = -0.4 * (1 - smoothstep(0.5, 2.2, joint));
  const arris = -0.06 * (1 - smoothstep(2, 6, joint));

  const stain = smoothstep(0.55, 0.75, fbm(u, v, 3, 4, SEED + 7)) * -0.1;
  const polish = smoothstep(0.55, 0.8, fbm(u, v, 5, 3, SEED + 8)) * 0.04;
  return (
    0.72 +
    slabTone +
    mottle +
    grain +
    pores +
    cut +
    arris +
    stain +
    polish -
    0.3 * cracks(u, v, SEED + 9)
  );
};

/** Asphalt: dark binder, bright chips, a patched seam, polished wheel paths and cracks. */
const asphalt: Field = (u, v, x, y) => {
  const binder = 0.55 + (fbm(u, v, 5, 4, SEED + 11) - 0.5) * 0.14;
  const chips = fbm(u, v, 256, 2, SEED + 12, 0.7);
  const chip = smoothstep(0.5, 0.7, chips) * 0.2;
  const speck = hash(x, y, SEED + 13);
  const flecks = speck > 0.99 ? 0.16 : speck < 0.02 ? -0.1 : 0;
  const worn = smoothstep(0.5, 0.75, fbm(u, v, 4, 4, SEED + 14)) * 0.12;
  const seamX = toLine(x + (fbm(u, v, 8, 2, SEED + 15) - 0.5) * 30, SIZE);
  const seam = seamX < 12 ? -0.16 * smoothstep(12, 8, seamX) + (seamX < 5 ? 0.06 : 0) : 0;
  const patch = smoothstep(0.62, 0.7, fbm(u, v, 3, 3, SEED + 17)) * -0.1;
  return binder + chip + flecks + worn + seam + patch - 0.28 * cracks(u, v, SEED + 16);
};

const PAVER = { length: 64, height: 32 };

/** Pavers in running bond: per-stone tone, bevelled edges, sand joints, stains. */
const pavers: Field = (u, v, x, y) => {
  const row = Math.floor(y / PAVER.height);
  const shifted = x + (row % 2 === 0 ? 0 : PAVER.length / 2);
  const perRow = SIZE / PAVER.length;
  const id = (((Math.floor(shifted / PAVER.length) % perRow) + perRow) % perRow) | 0;
  const tone = (hash(id, row, SEED + 21) - 0.5) * 0.14;
  const edge = Math.min(toLine(shifted, PAVER.length), toLine(y, PAVER.height));
  const joint = -0.34 * (1 - smoothstep(1.5, 3.5, edge));
  const bevel = 0.06 * smoothstep(3.5, 5.5, edge) - 0.04;
  const sand = (1 - smoothstep(1.5, 3.5, edge)) * (hash(x, y, SEED + 22) - 0.3) * 0.16;
  const grain = (fbm(u, v, 256, 2, SEED + 23, 0.7) - 0.5) * 0.1;
  const sunk = hash(id, row, SEED + 24) > 0.97 ? -0.08 : 0;
  const stain = smoothstep(0.58, 0.78, fbm(u, v, 4, 4, SEED + 25)) * -0.12;
  const worn = smoothstep(0.55, 0.8, fbm(u, v, 6, 3, SEED + 26)) * 0.04;
  return 0.72 + tone + joint + bevel + sand + grain + sunk + stain + worn;
};

const FIELDS: Readonly<Record<GroundMaterial, Field>> = { concrete, asphalt, pavers };

/** Shifts `values` until their mean is `GROUND_TEXTURE_MEAN`, clamped to [0, 1]. */
function normalise(values: Float32Array): void {
  for (let pass = 0; pass < 8; pass++) {
    let sum = 0;
    for (const value of values) sum += clamp01(value);
    const shift = GROUND_TEXTURE_MEAN - sum / values.length;
    for (let i = 0; i < values.length; i++) values[i] = clamp01((values[i] ?? 0) + shift);
  }
}

export type GroundPixels = {
  readonly width: number;
  readonly height: number;
  /** Row-major RGBA, A = 255. */
  readonly rgba: Uint8Array;
};

export function generateGroundTexture(): GroundPixels {
  const rgba = new Uint8Array(SIZE * SIZE * 4).fill(255);
  for (const [name, channel] of Object.entries(GROUND_CHANNELS) as [GroundMaterial, number][]) {
    const field = FIELDS[name];
    const values = new Float32Array(SIZE * SIZE);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) values[y * SIZE + x] = field(x / SIZE, y / SIZE, x, y);
    }
    normalise(values);
    for (let i = 0; i < values.length; i++) {
      rgba[i * 4 + channel] = Math.round((values[i] ?? 0) * 255);
    }
  }
  return { width: SIZE, height: SIZE, rgba };
}
