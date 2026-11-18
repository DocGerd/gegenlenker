// Usage: node scripts/cab-optimise.mjs <raw.glb>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { argv } from 'node:process';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { runnerImport } from 'vite';

const input = argv[2];
if (input === undefined) throw new Error('usage: cab-optimise.mjs <raw.glb>');

const root = join(import.meta.dirname, '..');
const { module } = await runnerImport('/tools/blender/cab-build.ts', {
  root,
  configFile: false,
  logLevel: 'error',
});

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO()
  .registerExtensions([...ALL_EXTENSIONS, EXTMeshoptCompression])
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const document = await io.readBinary(readFileSync(input));
await document.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));

// Exporter and tool stamps change with versions and runs; the manifest records the versions instead.
const asset = document.getRoot().getAsset();
asset.generator = 'gegenlenker cab-optimise';
asset.extras = {};
document.getRoot().setExtras({});

const out = join(root, module.CAB_FILES.glb);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, await io.writeBinary(document));
