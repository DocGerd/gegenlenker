/*
 * Seeded, periodic value noise built from integer hashing and IEEE-exact arithmetic only: no
 * Math.sin, pow or exp, which differ between engines, so the pixels are identical on every machine.
 */

export function hash(x: number, y: number, seed: number): number {
  let h =
    Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}

const fade = (t: number): number => t * t * (3 - 2 * t);

/** Value noise in [0, 1] on a lattice that repeats every `period` cells; `u`, `v` are in [0, 1). */
export function noise(u: number, v: number, period: number, seed: number): number {
  const x = u * period;
  const y = v * period;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = fade(x - x0);
  const fy = fade(y - y0);
  const xa = x0 % period;
  const xb = (x0 + 1) % period;
  const ya = y0 % period;
  const yb = (y0 + 1) % period;
  const top = hash(xa, ya, seed) * (1 - fx) + hash(xb, ya, seed) * fx;
  const bottom = hash(xa, yb, seed) * (1 - fx) + hash(xb, yb, seed) * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Fractal sum of octaves, each at twice the period; result in [0, 1]. */
export function fbm(
  u: number,
  v: number,
  period: number,
  octaves: number,
  seed: number,
  gain = 0.5,
): number {
  let sum = 0;
  let amplitude = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amplitude * noise(u, v, period << o, seed + o * 31);
    total += amplitude;
    amplitude *= gain;
  }
  return sum / total;
}

export const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** Tileable ridge in [0, 1]: 1 along the zero set of the noise, where hairline cracks run. */
export function ridge(u: number, v: number, period: number, octaves: number, seed: number): number {
  return 1 - Math.abs(fbm(u, v, period, octaves, seed) * 2 - 1);
}
