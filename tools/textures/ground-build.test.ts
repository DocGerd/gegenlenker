import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { KHR_DF_TRANSFER_SRGB, read } from 'ktx-parse';
import { describe, expect, it } from 'vitest';
import { GROUND_TEXTURE_MEAN, GROUND_TEXTURE_SIZE } from '../../src/render/ground-texture-pixels';
import {
  encoderVersion,
  GROUND_FILES,
  type GroundManifest,
  inputsSha256,
  KV_INPUTS,
  ktx2Sha256,
  ROOT,
  sha256,
} from './ground-build';
import { channelFidelity, decodeGroundTexture } from './ground-decode';
import { generateGroundTexture } from './ground-texture';

const manifest = JSON.parse(
  readFileSync(join(ROOT, GROUND_FILES.manifest), 'utf8'),
) as GroundManifest;
const pixels = generateGroundTexture();
const container = read(new Uint8Array(readFileSync(join(ROOT, GROUND_FILES.ktx2))));

/** Below this a channel's detail is visibly smeared by the compression. */
const MIN_PSNR_DB = 32;

/** Red means stale inputs: rerun `pnpm ground:texture` and commit the new .ktx2 and manifest. */
describe('ground texture build', () => {
  it('hashes the generator inputs and the ktx2 recorded in the manifest', () => {
    expect({
      inputsSha256: inputsSha256(),
      ktx2Sha256: ktx2Sha256(),
      ktx2Bytes: statSync(join(ROOT, GROUND_FILES.ktx2)).size,
      encoderVersion: encoderVersion(),
    }).toEqual({
      inputsSha256: manifest.inputsSha256,
      ktx2Sha256: manifest.ktx2Sha256,
      ktx2Bytes: manifest.ktx2Bytes,
      encoderVersion: manifest.encoderVersion,
    });
  });

  it('was encoded from the current generator inputs', () => {
    const recorded = container.keyValue[KV_INPUTS];
    expect(new TextDecoder().decode(recorded as Uint8Array).replace(/\0$/, '')).toBe(
      inputsSha256(),
    );
  });

  it('generates the pixels the manifest records', () => {
    const { width, height, rgba } = pixels;
    expect({ width, height, pixelsSha256: sha256(rgba) }).toEqual({
      width: manifest.width,
      height: manifest.height,
      pixelsSha256: manifest.pixelsSha256,
    });
  });

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
