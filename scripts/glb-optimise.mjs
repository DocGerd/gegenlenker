// Usage: node scripts/glb-optimise.mjs <asset key> <raw.glb> [out.glb]
// Without out.glb the committed asset is written.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { argv } from 'node:process';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { runnerImport } from 'vite';

const [key, input, target] = argv.slice(2);
if (key === undefined || input === undefined) {
  throw new Error('usage: glb-optimise.mjs <asset key> <raw.glb> [out.glb]');
}

const root = join(import.meta.dirname, '..');
const { module } = await runnerImport('/tools/blender/glb-build.ts', {
  root,
  configFile: false,
  logLevel: 'error',
});
const asset = module.assetByKey(key);

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO()
  .registerExtensions([...ALL_EXTENSIONS, EXTMeshoptCompression])
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const document = await io.readBinary(readFileSync(input));
const [scene] = document.getRoot().listScenes();
if (scene === undefined) throw new Error(`${input} has no scene`);
scene.setExtras({ ...scene.getExtras(), optimiseSha256: module.optimiseSha256(root) });
await document.transform(
  prune({ keepAttributes: true }),
  meshopt({ encoder: MeshoptEncoder, level: 'high' }),
);

// Exporter and tool stamps change with versions and runs; the manifest records the versions instead.
const gltfAsset = document.getRoot().getAsset();
gltfAsset.generator = 'gegenlenker glb-optimise';
gltfAsset.extras = {};
document.getRoot().setExtras({});

const out = target ?? join(root, asset.glb);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, await io.writeBinary(document));
