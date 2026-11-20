import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { read } from 'ktx-parse';
import { describe, expect, it } from 'vitest';
import { HDRI_LIGHT } from '../../src/render/hdri-light';
import { ASSET_REGISTRY } from '../../src/render/asset-registry';
import { encoderVersion, KV_INPUTS, readKv, ROOT, sha256 } from './provenance';
import { bakedSha256, TEXTURE_ASSETS, type TextureManifest } from './textures';

const assets = Object.values(TEXTURE_ASSETS);

/** Red means stale inputs: rerun `pnpm texture <key>` and commit the .ktx2 and its manifest. */
describe.each(assets)('texture $key', (asset) => {
  const manifest = JSON.parse(readFileSync(join(ROOT, asset.manifest), 'utf8')) as TextureManifest;
  const bytes = new Uint8Array(readFileSync(join(ROOT, asset.ktx2)));

  it('has the hashes, size and encoder its manifest records', () => {
    expect({
      inputsSha256: asset.inputsSha256(ROOT),
      ktx2Sha256: sha256(bytes),
      ktx2Bytes: statSync(join(ROOT, asset.ktx2)).size,
      encoderVersion: encoderVersion(),
    }).toEqual({
      inputsSha256: manifest.inputsSha256,
      ktx2Sha256: manifest.ktx2Sha256,
      ktx2Bytes: manifest.ktx2Bytes,
      encoderVersion: manifest.encoderVersion,
    });
  });

  it('was encoded from the current inputs', () => {
    expect(readKv(bytes, KV_INPUTS)).toBe(asset.inputsSha256(ROOT));
  });

  it('has the dimensions its manifest records', () => {
    const { pixelWidth, pixelHeight, levelCount } = read(bytes);
    expect({ width: pixelWidth, height: pixelHeight, mipLevels: levelCount }).toEqual({
      width: manifest.width,
      height: manifest.height,
      mipLevels: manifest.mipLevels,
    });
  });

  it.skipIf(!asset.available(ROOT))(
    'generates the pixels its manifest records (skipped without its uncommitted sources, see docs/asset-credits.md)',
    () => {
      expect(sha256(asset.pixels(ROOT).rgba)).toBe(manifest.pixelsSha256);
    },
  );

  it('records its baked data exactly when it bakes', () => {
    expect(manifest.bakedSha256).toBe(asset.bake?.bakedSha256());
  });
});

describe('texture registry', () => {
  it('covers exactly the ktx2 entries of ASSET_REGISTRY', () => {
    const ktx2Keys = Object.entries(ASSET_REGISTRY)
      .filter(([, entry]) => entry.kind === 'ktx2')
      .map(([key]) => key);
    expect(Object.keys(TEXTURE_ASSETS).sort()).toEqual(ktx2Keys.sort());
    for (const [key, asset] of Object.entries(TEXTURE_ASSETS)) {
      expect(asset.key).toBe(key);
      expect(asset.ktx2).toBe(`src/render/assets/${key}.ktx2`);
    }
  });

  it('keeps the committed HDRI light as baked, whether or not the .hdr is present', () => {
    const sky = TEXTURE_ASSETS.sky;
    if (sky === undefined) throw new Error('no sky texture is registered');
    const manifest = JSON.parse(readFileSync(join(ROOT, sky.manifest), 'utf8')) as TextureManifest;
    expect(bakedSha256(HDRI_LIGHT)).toBe(manifest.bakedSha256);
  });
});
