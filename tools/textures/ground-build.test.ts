import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { KHR_DF_TRANSFER_SRGB, read } from 'ktx-parse';
import { describe, expect, it } from 'vitest';
import { MAX_PRECACHE_FILE_BYTES } from '../../src/pwa/config';
import { GROUND_TEXTURE_MEAN, GROUND_TEXTURE_SIZE } from '../../src/render/ground-texture-spec';
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
import { generateGroundTexture } from './ground-texture';

const manifest = JSON.parse(
  readFileSync(join(ROOT, GROUND_FILES.manifest), 'utf8'),
) as GroundManifest;
const container = read(new Uint8Array(readFileSync(join(ROOT, GROUND_FILES.ktx2))));

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

  it('generates the pixels the manifest records', { timeout: 60_000 }, () => {
    const { width, height, rgba } = generateGroundTexture();
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

  it('keeps each channel at the mean the shader compensates for', { timeout: 60_000 }, () => {
    const { rgba } = generateGroundTexture();
    for (let channel = 0; channel < 3; channel++) {
      let sum = 0;
      for (let i = channel; i < rgba.length; i += 4) sum += rgba[i] ?? 0;
      expect(sum / (rgba.length / 4) / 255).toBeCloseTo(GROUND_TEXTURE_MEAN, 2);
    }
  });

  it('fits the Workbox precache limit', () => {
    expect(manifest.ktx2Bytes).toBeLessThanOrEqual(MAX_PRECACHE_FILE_BYTES);
  });
});
