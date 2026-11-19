// Usage: node scripts/texture.mjs <key|all>   (pnpm texture)
// Builds a texture's ktx2 from its registered pixels, bakes its runtime constant if it has one, and writes its manifest.
import console from 'node:console';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { encodeToKTX2 } from 'ktx2-encoder';
import { read } from 'ktx-parse';
import { format, resolveConfig } from 'prettier';
import { runnerImport } from 'vite';

const root = join(import.meta.dirname, '..');
const load = async (file) =>
  (await runnerImport(file, { root, configFile: false, logLevel: 'error' })).module;
const { TEXTURE_ASSETS } = await load('/tools/assets/textures.ts');
const { KV_INPUTS, encoderVersion, sha256 } = await load('/tools/assets/provenance.ts');

const arg = process.argv[2];
const keys = arg === 'all' ? Object.keys(TEXTURE_ASSETS) : [arg];
for (const key of keys) {
  if (!Object.hasOwn(TEXTURE_ASSETS, key)) {
    throw new Error(`usage: pnpm texture <${[...Object.keys(TEXTURE_ASSETS), 'all'].join('|')}>`);
  }
}

async function encode(asset) {
  const pixels = asset.pixels(root);
  const inputsSha256 = asset.inputsSha256(root);
  // The encoder logs every slice to stdout.
  const log = console.log;
  console.log = () => undefined;
  const ktx2 = await encodeToKTX2(pixels.rgba, {
    ...asset.encoding.options,
    imageDecoder: async () => ({ width: pixels.width, height: pixels.height, data: pixels.rgba }),
    kvData: { [KV_INPUTS]: inputsSha256 },
  });
  console.log = log;
  writeFileSync(join(root, asset.ktx2), ktx2);
  if (asset.bake !== undefined) {
    const file = join(root, asset.bake.file);
    const source = asset.bake.source(root, ktx2);
    writeFileSync(file, await format(source, { ...(await resolveConfig(file)), filepath: file }));
  }
  return pixels;
}

async function record(asset, pixels = asset.pixels(root)) {
  const bytes = new Uint8Array(readFileSync(join(root, asset.ktx2)));
  const { pixelWidth, pixelHeight, levelCount } = read(bytes);
  const manifest = {
    inputsSha256: asset.inputsSha256(root),
    pixelsSha256: sha256(pixels.rgba),
    encoderVersion: encoderVersion(root),
    width: pixelWidth,
    height: pixelHeight,
    mipLevels: levelCount,
    ktx2Sha256: sha256(bytes),
    ktx2Bytes: statSync(join(root, asset.ktx2)).size,
    ...(asset.bake === undefined ? {} : { bakedSha256: asset.bake.bakedSha256() }),
  };
  const file = join(root, asset.manifest);
  const config = await resolveConfig(file);
  writeFileSync(file, await format(JSON.stringify(manifest), { ...config, filepath: file }));
  console.log(`${asset.ktx2}: ${manifest.ktx2Bytes} bytes`);
}

for (const key of keys) {
  const asset = TEXTURE_ASSETS[key];
  const pixels = await encode(asset);
  // a bake rewrote a module the registry reads, so read it again
  const fresh =
    asset.bake === undefined
      ? asset
      : (await load('/tools/assets/textures.ts')).TEXTURE_ASSETS[key];
  await record(fresh, pixels);
}
