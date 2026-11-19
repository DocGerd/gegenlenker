// Usage: node tools/textures/hdri-light.ts <equirect.hdr> <sky.ktx2>
// Bakes the perspective light rig from the sky HDRI: sun direction, colour and irradiance, the SH9
// radiance of the sky with the sun clamped out, and the horizon colours. Writes
// src/render/hdri-light.ts; the runtime scales everything to the scene's brightness.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type RadianceImage = {
  readonly width: number;
  readonly height: number;
  readonly rgb: Float32Array;
};

/** Run-length encoded Radiance RGBE, the only layout Poly Haven ships (`-Y h +X w`). */
export function parseRadianceHdr(bytes: Uint8Array): RadianceImage {
  let p = 0;
  const line = (): string => {
    let s = '';
    while (p < bytes.length && bytes[p] !== 10) s += String.fromCharCode(bytes[p++] ?? 0);
    p++;
    return s;
  };
  const magic = line();
  if (!/^#\?(RADIANCE|RGBE)/.test(magic)) throw new Error('not a Radiance HDR file');
  while (line() !== '') {
    /* header lines */
  }
  const size = /^-Y (\d+) \+X (\d+)$/.exec(line());
  if (size === null) throw new Error('unsupported HDR orientation');
  const height = Number(size[1]);
  const width = Number(size[2]);
  const rgb = new Float32Array(width * height * 3);
  const scan = new Uint8Array(width * 4);
  for (let y = 0; y < height; y++) {
    if (
      bytes[p] !== 2 ||
      bytes[p + 1] !== 2 ||
      (((bytes[p + 2] ?? 0) << 8) | (bytes[p + 3] ?? 0)) !== width
    ) {
      throw new Error('not an RLE scanline');
    }
    p += 4;
    for (let c = 0; c < 4; c++) {
      for (let x = 0; x < width;) {
        let n = bytes[p++] ?? 0;
        if (n > 128) {
          n -= 128;
          const v = bytes[p++] ?? 0;
          while (n-- > 0) scan[x++ * 4 + c] = v;
        } else {
          while (n-- > 0) scan[x++ * 4 + c] = bytes[p++] ?? 0;
        }
      }
    }
    for (let x = 0; x < width; x++) {
      const e = scan[x * 4 + 3] ?? 0;
      const f = e === 0 ? 0 : 2 ** (e - 136);
      for (let c = 0; c < 3; c++) rgb[(y * width + x) * 3 + c] = (scan[x * 4 + c] ?? 0) * f;
    }
  }
  return { width, height, rgb };
}

type Rgb = [number, number, number];

export type HdriLight = {
  /** Texels brighter than this luminance are sun; the sky texture is clamped at the same value. */
  readonly clampLuminance: number;
  readonly sun: {
    readonly elevation: number;
    /** Equirect u of the sun in the HDRI (row 0 is the zenith, u = atan2(z, x) / 2π). */
    readonly u: number;
    /** Irradiance on a surface facing the sun, in HDRI units, and its colour (luminance 1). */
    readonly irradiance: number;
    readonly colour: Rgb;
  };
  /** Horizontal irradiance of the clamped sky, in HDRI units. */
  readonly skyIrradiance: number;
  /** Three-space azimuth (atan2(z, x)) the sun is rotated to. */
  readonly azimuth: number;
  /** SH9 radiance of the clamped upper hemisphere in three's basis and Three space, sun at `azimuth`. */
  readonly skySh: readonly Rgb[];
  /** Mean clamped radiance in the lowest degrees above the horizon, towards and away from the sun. */
  readonly horizonToward: Rgb;
  readonly horizonAway: Rgb;
};

const luminance = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

const HORIZON_BAND = (4 * Math.PI) / 180;

/** three's SH9 basis (`SphericalHarmonics3.getBasisAt`); tools may not import three. */
export function shBasis(x: number, y: number, z: number): number[] {
  return [
    0.282095,
    0.488603 * y,
    0.488603 * z,
    0.488603 * x,
    1.092548 * x * y,
    1.092548 * y * z,
    0.315392 * (3 * z * z - 1),
    1.092548 * x * z,
    0.546274 * (x * x - y * y),
  ];
}

/** South-west, where the legacy sun stands: world (−x, −y) is Three (−x, +z). */
export const SUN_AZIMUTH = (3 * Math.PI) / 4;

export function bakeHdriLight(
  { width, height, rgb }: RadianceImage,
  azimuth = SUN_AZIMUTH,
): HdriLight {
  const upper = height / 2;
  const lum = new Float32Array(width * upper);
  for (let i = 0; i < lum.length; i++) {
    lum[i] = luminance(rgb[i * 3] ?? 0, rgb[i * 3 + 1] ?? 0, rgb[i * 3 + 2] ?? 0);
  }
  const sorted = Float32Array.from(lum).sort();
  const clamp = 20 * (sorted[sorted.length >> 1] ?? 0);

  const sunSum = [0, 0, 0];
  const sunRgb: Rgb = [0, 0, 0];
  for (let y = 0; y < upper; y++) {
    const theta = ((y + 0.5) / height) * Math.PI;
    const solid = ((2 * Math.PI) / width) * (Math.PI / height) * Math.sin(theta);
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const l = lum[i] ?? 0;
      if (l <= clamp) continue;
      const phi = ((x + 0.5) / width) * 2 * Math.PI;
      const dir = [
        Math.sin(theta) * Math.cos(phi),
        Math.cos(theta),
        Math.sin(theta) * Math.sin(phi),
      ];
      for (let c = 0; c < 3; c++) sunSum[c] = (sunSum[c] ?? 0) + (dir[c] ?? 0) * l * solid;
      const excess = 1 - clamp / l;
      for (let c = 0; c < 3; c++)
        sunRgb[c] = (sunRgb[c] ?? 0) + (rgb[i * 3 + c] ?? 0) * excess * solid;
    }
  }
  const [sx = 0, sy = 0, sz = 0] = sunSum;
  const sunLength = Math.hypot(sx, sy, sz);
  const sunPhi = Math.atan2(sz, sx);
  const sunIrradiance = luminance(...sunRgb);

  const sh: Rgb[] = Array.from({ length: 9 }, (): Rgb => [0, 0, 0]);
  const toward: Rgb = [0, 0, 0];
  const away: Rgb = [0, 0, 0];
  let towardWeight = 0;
  let awayWeight = 0;
  let skyIrradiance = 0;
  for (let y = 0; y < upper; y++) {
    const theta = ((y + 0.5) / height) * Math.PI;
    const solid = ((2 * Math.PI) / width) * (Math.PI / height) * Math.sin(theta);
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const l = lum[i] ?? 0;
      const scale = l > clamp ? clamp / l : 1;
      const colour = [0, 1, 2].map((c) => (rgb[i * 3 + c] ?? 0) * scale);
      const relative = ((x + 0.5) / width) * 2 * Math.PI - sunPhi;
      const phi = relative + azimuth;
      const basis = shBasis(
        Math.sin(theta) * Math.cos(phi),
        Math.cos(theta),
        Math.sin(theta) * Math.sin(phi),
      );
      sh.forEach((coefficient, j) => {
        for (let c = 0; c < 3; c++) {
          coefficient[c] = (coefficient[c] ?? 0) + (colour[c] ?? 0) * (basis[j] ?? 0) * solid;
        }
      });
      skyIrradiance += l * scale * Math.cos(theta) * solid;
      if (Math.PI / 2 - theta < HORIZON_BAND) {
        const facing = Math.cos(relative) >= 0;
        const side = facing ? toward : away;
        for (let c = 0; c < 3; c++) side[c] = (side[c] ?? 0) + (colour[c] ?? 0) * solid;
        if (facing) towardWeight += solid;
        else awayWeight += solid;
      }
    }
  }
  const round = (v: number): number => Number(v.toPrecision(6));
  const rgbOf = (v: Rgb, w: number): Rgb => [round(v[0] / w), round(v[1] / w), round(v[2] / w)];
  return {
    clampLuminance: round(clamp),
    sun: {
      elevation: round(Math.asin(sy / sunLength)),
      u: round((sunPhi / (2 * Math.PI) + 1) % 1),
      irradiance: round(sunIrradiance),
      colour: rgbOf(sunRgb, sunIrradiance),
    },
    skyIrradiance: round(skyIrradiance),
    azimuth: round(azimuth),
    skySh: sh.map(([r, g, b]) => [round(r), round(g), round(b)]),
    horizonToward: rgbOf(toward, towardWeight),
    horizonAway: rgbOf(away, awayWeight),
  };
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

if (import.meta.main) {
  const [hdrPath, ktx2Path] = process.argv.slice(2);
  if (hdrPath === undefined || ktx2Path === undefined) {
    console.error('usage: node tools/textures/hdri-light.ts <equirect.hdr> <sky.ktx2>');
    process.exit(2);
  }
  const hdr = new Uint8Array(readFileSync(hdrPath));
  const out = join(import.meta.dirname, '../../src/render/hdri-light.ts');
  const baked = {
    hdrSha256: sha256(hdr),
    skyKtx2Sha256: sha256(new Uint8Array(readFileSync(ktx2Path))),
    ...bakeHdriLight(parseRadianceHdr(hdr)),
  };
  const header =
    '// Generated by tools/textures/hdri-light.ts (docs/asset-credits.md); do not edit.';
  writeFileSync(out, `${header}\nexport const HDRI_LIGHT = ${JSON.stringify(baked)} as const;\n`);
  console.log(JSON.stringify(baked.sun));
}
