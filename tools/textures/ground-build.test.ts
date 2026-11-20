import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KHR_DF_TRANSFER_SRGB, read } from 'ktx-parse';
import { describe, expect, it } from 'vitest';
import { GROUND_TEXTURE_MEAN, GROUND_TEXTURE_SIZE } from '../../src/render/ground-texture-pixels';
import { ROOT } from '../assets/provenance';
import type { TextureManifest } from '../assets/textures';
import { GROUND_FILES } from './ground-build';
import { channelFidelity, decodeGroundTexture } from './ground-decode';
import { generateGroundTexture } from './ground-texture';

const manifest = JSON.parse(
  readFileSync(join(ROOT, GROUND_FILES.manifest), 'utf8'),
) as TextureManifest;
const pixels = generateGroundTexture();
const container = read(new Uint8Array(readFileSync(join(ROOT, GROUND_FILES.ktx2))));

/** Below this a channel's detail is visibly smeared by the compression. */
const MIN_PSNR_DB = 32;

/** Red means stale inputs: rerun `pnpm texture ground` and commit the new .ktx2 and manifest. */
describe('ground texture build', () => {
  it('is linear data with a full mip chain at the contract size', () => {
    expect(container.pixelWidth).toBe(GROUND_TEXTURE_SIZE);
    expect(container.pixelHeight).toBe(GROUND_TEXTURE_SIZE);
    expect(container.levelCount).toBe(manifest.mipLevels);
    expect(container.dataFormatDescriptor[0]?.transferFunction).not.toBe(KHR_DF_TRANSFER_SRGB);
  });

  it('decodes close to the source with each channel at the mean the shader assumes', async () => {
    const decoded = await decodeGroundTexture(
      new Uint8Array(readFileSync(join(ROOT, GROUND_FILES.ktx2))),
    );
    const channels = channelFidelity(pixels.rgba, decoded);
    for (const { psnr, mean } of channels) {
      expect(psnr).toBeGreaterThan(MIN_PSNR_DB);
      expect(mean).toBeCloseTo(GROUND_TEXTURE_MEAN, 2);
    }
  });
});
