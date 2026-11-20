import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KHR_DF_TRANSFER_SRGB, read } from 'ktx-parse';
import { describe, expect, it } from 'vitest';
import { HDRI_LIGHT } from '../../src/render/hdri-light';
import {
  bakeHdriLight,
  parseRadianceHdr,
  shBasis,
  SUN_AZIMUTH,
  validHdriLight,
  type RadianceImage,
} from './hdri-light';
import { ROOT, sha256 } from '../assets/provenance';
import { inputsSha256, SKY_FILES, SKY_HDR } from './sky-build';

const ktx2 = new Uint8Array(readFileSync(join(ROOT, SKY_FILES.ktx2)));
const container = read(ktx2);
const hdrPath = join(ROOT, SKY_HDR.path);
const hdrPresent = existsSync(hdrPath);

/** Red means stale inputs: rerun `pnpm texture sky` and commit sky.ktx2, hdri-light.ts and the manifest. */
describe('sky texture build', () => {
  it('baked the light from the same inputs and the sky texture that ships', () => {
    expect({
      inputsSha256: HDRI_LIGHT.inputsSha256,
      hdrSha256: HDRI_LIGHT.hdrSha256,
      skyKtx2Sha256: HDRI_LIGHT.skyKtx2Sha256,
    }).toEqual({
      inputsSha256: inputsSha256(),
      hdrSha256: SKY_HDR.sha256,
      skyKtx2Sha256: sha256(ktx2),
    });
  });

  it('is one sRGB level of the upper hemisphere', () => {
    expect([container.pixelWidth, container.pixelHeight, container.levelCount]).toEqual([
      4096, 1024, 1,
    ]);
    expect(container.dataFormatDescriptor[0]?.transferFunction).toBe(KHR_DF_TRANSFER_SRGB);
  });

  it.skipIf(!hdrPresent)(
    `re-bakes the committed light from ${SKY_HDR.path} (skipped when absent: it is not committed; download ${SKY_HDR.url})`,
    () => {
      const hdr = new Uint8Array(readFileSync(hdrPath));
      expect(sha256(hdr)).toBe(SKY_HDR.sha256);
      // every baked field, and only those, matches the committed one
      expect({ ...HDRI_LIGHT, ...bakeHdriLight(parseRadianceHdr(hdr)) }).toEqual(HDRI_LIGHT);
    },
  );
});

/** A 128 × 64 equirect with a constant sky, a point sun at `sun`, and `bright` on the sun's half. */
function synthetic(sun: { x: number; y: number }, bright = 0.5): RadianceImage {
  const width = 128;
  const height = 64;
  const rgb = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const near = Math.cos(((x - sun.x) / width) * 2 * Math.PI) >= 0;
      rgb.fill(near ? bright : 0.5, (y * width + x) * 3, (y * width + x) * 3 + 3);
    }
  }
  rgb.fill(1000, (sun.y * width + sun.x) * 3, (sun.y * width + sun.x) * 3 + 3);
  return { width, height, rgb };
}

/** SH9 radiance of `light`'s sky along a direction in Three space. */
function radiance(light: ReturnType<typeof bakeHdriLight>, x: number, y: number, z: number) {
  const basis = shBasis(x, y, z);
  return [0, 1, 2].map((c) =>
    light.skySh.reduce((sum, coefficient, j) => sum + (coefficient[c] ?? 0) * (basis[j] ?? 0), 0),
  );
}

describe('HDRI bake', () => {
  it('finds a point sun and turns the sky so it stands at the given azimuth', () => {
    const sun = { x: 80, y: 10 }; // row 0 is the zenith
    const baked = bakeHdriLight(synthetic(sun));
    expect(baked.sun.elevation).toBeCloseTo(Math.PI / 2 - ((sun.y + 0.5) / 64) * Math.PI, 5);
    expect(baked.sun.u).toBeCloseTo((sun.x + 0.5) / 128, 5);
    expect(baked.azimuth).toBeCloseTo(SUN_AZIMUTH, 5);
    // the clamped sky is a constant 0.5 over the upper hemisphere: E = π L on an upward surface
    expect(baked.skyIrradiance).toBeCloseTo(0.5 * Math.PI, 1);
  });

  it('turns a sky brighter on the sun side with the sun', () => {
    const baked = bakeHdriLight(synthetic({ x: 20, y: 10 }, 2));
    const toward = [Math.cos(SUN_AZIMUTH), 0.2, Math.sin(SUN_AZIMUTH)] as const;
    const towardSky = radiance(baked, ...toward);
    const awaySky = radiance(baked, -toward[0], toward[1], -toward[2]);
    for (let c = 0; c < 3; c++) {
      expect(towardSky[c]).toBeGreaterThan(awaySky[c] ?? Infinity);
      expect(baked.horizonToward[c]).toBeGreaterThan(baked.horizonAway[c] ?? Infinity);
    }
  });

  it('refuses a sky without a sun', () => {
    const black = { width: 128, height: 64, rgb: new Float32Array(128 * 64 * 3) };
    expect(() => bakeHdriLight(black)).toThrow(/not usable/);
    const flat = { ...black, rgb: new Float32Array(128 * 64 * 3).fill(0.5) };
    expect(() => bakeHdriLight(flat)).toThrow(/not usable/);
  });

  it('refuses a malformed bake', () => {
    const good = bakeHdriLight(synthetic({ x: 80, y: 10 }));
    expect(validHdriLight(good)).toBe(good);
    expect(() => validHdriLight({ ...good, skySh: good.skySh.slice(1) })).toThrow(/sky SH/);
    expect(() => validHdriLight({ ...good, skyIrradiance: NaN })).toThrow(/sky irradiance/);
  });
});
