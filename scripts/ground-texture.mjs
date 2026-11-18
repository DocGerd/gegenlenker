// Usage: node scripts/ground-texture.mjs   (pnpm ground:texture)
// Generates the ground texture from seeded noise, encodes it to KTX2 and writes the manifest.
import console from 'node:console';
import { statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeToKTX2 } from 'ktx2-encoder';
import { format, resolveConfig } from 'prettier';
import { runnerImport } from 'vite';

const root = join(import.meta.dirname, '..');
const load = async (file) =>
  (await runnerImport(file, { root, configFile: false, logLevel: 'error' })).module;
const build = await load('/tools/textures/ground-build.ts');
const { generateGroundTexture } = await load('/tools/textures/ground-texture.ts');

const pixels = generateGroundTexture();
const inputsSha256 = build.inputsSha256(root);
const pixelsSha256 = build.sha256(pixels.rgba);

// The encoder logs every slice to stdout.
const log = console.log;
console.log = () => undefined;
const ktx2 = await encodeToKTX2(pixels.rgba, {
  ...build.ENCODER_OPTIONS,
  imageDecoder: async () => ({ width: pixels.width, height: pixels.height, data: pixels.rgba }),
  kvData: { [build.KV_INPUTS]: inputsSha256 },
});
console.log = log;

const out = join(root, build.GROUND_FILES.ktx2);
writeFileSync(out, ktx2);

const manifest = {
  inputsSha256,
  pixelsSha256,
  encoderVersion: build.encoderVersion(root),
  width: pixels.width,
  height: pixels.height,
  mipLevels: Math.floor(Math.log2(Math.max(pixels.width, pixels.height))) + 1,
  ktx2Sha256: build.ktx2Sha256(root),
  ktx2Bytes: statSync(out).size,
};
const file = join(root, build.GROUND_FILES.manifest);
const config = await resolveConfig(file);
writeFileSync(file, await format(JSON.stringify(manifest), { ...config, filepath: file }));
console.log(`${build.GROUND_FILES.ktx2}: ${manifest.ktx2Bytes} bytes`);
