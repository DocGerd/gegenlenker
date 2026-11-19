// Usage: node scripts/kit-atlas.mjs <run key> <bake dir>   (pnpm kit:atlas)
// Encodes the raw atlases a kit bake wrote (<texture key>.rgba + .json) to KTX2 and writes their manifests.
import console from 'node:console';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { argv } from 'node:process';
import { encodeToKTX2 } from 'ktx2-encoder';
import { format, resolveConfig } from 'prettier';
import { runnerImport } from 'vite';

const [runKey, dir] = argv.slice(2);
if (runKey === undefined || dir === undefined) {
  throw new Error('usage: kit-atlas.mjs <run key> <bake dir>');
}

const root = join(import.meta.dirname, '..');
const load = async (file) =>
  (await runnerImport(file, { root, configFile: false, logLevel: 'error' })).module;
const glb = await load('/tools/blender/glb-build.ts');
const kit = await load('/tools/blender/kit-build.ts');

const textures = kit.KIT_TEXTURES.filter((t) => t.run.key === runKey);
if (textures.length === 0) throw new Error(`no kit textures for run "${runKey}"`);

for (const t of textures) {
  const hashes = glb.runHashes(t.run, root);
  const record = JSON.parse(readFileSync(join(dir, `${t.key}.json`), 'utf8'));
  const stale = Object.entries(hashes).filter(([k, v]) => record[k] !== v);
  if (stale.length > 0) {
    throw new Error(`${t.key}: baked from other inputs (${stale.map(([k]) => k).join(', ')})`);
  }
  const rgba = new Uint8Array(readFileSync(join(dir, `${t.key}.rgba`)));
  if (glb.sha256(rgba) !== record.pixelsSha256)
    throw new Error(`${t.key}: pixels differ from the bake record`);
  if (record.width !== t.size || record.height !== t.size) {
    throw new Error(`${t.key}: ${record.width}x${record.height}, expected ${t.size}²`);
  }

  const inputsSha256 = kit.textureInputsSha256(t, root);
  // The encoder logs every slice to stdout.
  const log = console.log;
  console.log = () => undefined;
  const ktx2 = await encodeToKTX2(rgba, {
    ...kit.KTX2_ENCODINGS[t.encoding],
    imageDecoder: async () => ({ width: t.size, height: t.size, data: rgba }),
    kvData: { [kit.KV_INPUTS]: inputsSha256 },
  });
  console.log = log;

  const out = join(root, t.ktx2);
  writeFileSync(out, ktx2);
  const manifest = {
    ...hashes,
    pixelsSha256: record.pixelsSha256,
    blenderVersion: record.blender,
    encoderVersion: kit.encoderVersion(root),
    inputsSha256,
    width: t.size,
    height: t.size,
    mipLevels: Math.floor(Math.log2(t.size)) + 1,
    ktx2Sha256: kit.ktx2Sha256(t, root),
    ktx2Bytes: statSync(out).size,
  };
  const file = join(root, t.manifest);
  const config = await resolveConfig(file);
  writeFileSync(file, await format(JSON.stringify(manifest), { ...config, filepath: file }));
  console.log(`${t.ktx2}: ${manifest.ktx2Bytes} bytes`);
}
