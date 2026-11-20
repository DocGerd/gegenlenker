import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KHR_DF_TRANSFER_SRGB, read } from 'ktx-parse';
import { describe, expect, it } from 'vitest';
import { PBR_ALBEDO_MEAN, PBR_SIZE } from '../../src/render/ground-pbr-pixels';
import { ROOT } from '../assets/provenance';
import { decodeGroundTexture } from './ground-decode';
import { linearMeans } from './pbr-pack';
import { PBR_MAPS, pbrPixels, pbrSourcesPresent } from './pbr-build';

/** Below this a channel's detail is visibly smeared by the compression; ETC1S albedo detail is low in amplitude and smears more. */
const MIN_PSNR_DB = { albedo: 20, packed: 28 } as const;
const MIPS = Math.log2(PBR_SIZE) + 1;

const load = (key: string): Uint8Array =>
  new Uint8Array(readFileSync(join(ROOT, `src/render/assets/${key}.ktx2`)));

/** Red means stale inputs: rerun `pnpm texture <key>` and commit the .ktx2 and its manifest. */
describe.each(PBR_MAPS)('PBR ground map $key', ({ key, surface, role }) => {
  const bytes = load(key);

  it('is a full mip chain at the contract size, sRGB only for the albedo', () => {
    const container = read(bytes);
    expect([container.pixelWidth, container.pixelHeight, container.levelCount]).toEqual([
      PBR_SIZE,
      PBR_SIZE,
      MIPS,
    ]);
    const srgb = container.dataFormatDescriptor[0]?.transferFunction === KHR_DF_TRANSFER_SRGB;
    expect(srgb).toBe(role === 'albedo');
  });

  it('decodes to the albedo mean the shader assumes, or to a unit-disc normal', async () => {
    const decoded = await decodeGroundTexture(bytes);
    if (role === 'albedo') {
      for (const mean of linearMeans(decoded)) expect(mean).toBeCloseTo(PBR_ALBEDO_MEAN, 1);
      return;
    }
    // the normal XY of a decoded texel stays inside the unit disc, give or take quantisation
    let outside = 0;
    const texels = decoded.length / 4;
    for (let i = 0; i < texels; i += 97) {
      const x = ((decoded[i * 4] ?? 0) / 255) * 2 - 1;
      const y = ((decoded[i * 4 + 1] ?? 0) / 255) * 2 - 1;
      if (x * x + y * y > 1.05) outside++;
    }
    expect(outside / (texels / 97)).toBeLessThan(0.01);
  });

  it.skipIf(!pbrSourcesPresent(surface, role))(
    'decodes close to its source (skipped without the uncommitted downloads, see docs/asset-credits.md)',
    async () => {
      const source = pbrPixels(surface, role).rgba;
      const decoded = await decodeGroundTexture(bytes);
      const channels = role === 'albedo' ? 3 : 4;
      for (let c = 0; c < channels; c++) {
        let squared = 0;
        for (let i = c; i < source.length; i += 4)
          squared += ((decoded[i] ?? 0) - (source[i] ?? 0)) ** 2;
        const psnr = 10 * Math.log10(255 ** 2 / (squared / (source.length / 4)));
        expect(psnr, `channel ${c}`).toBeGreaterThan(MIN_PSNR_DB[role]);
      }
    },
    120_000,
  );
});
