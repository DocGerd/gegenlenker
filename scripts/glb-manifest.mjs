// Usage: node scripts/glb-manifest.mjs "<Blender version string>"
// Writes the manifest of every asset from the files on disk.
import { statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { argv } from 'node:process';
import { VERSION } from '@gltf-transform/core';
import { format, resolveConfig } from 'prettier';
import { runnerImport } from 'vite';

const blenderVersion = argv[2];
if (blenderVersion === undefined) throw new Error('usage: glb-manifest.mjs "<Blender version>"');

const root = join(import.meta.dirname, '..');
const { module } = await runnerImport('/tools/blender/glb-build.ts', {
  root,
  configFile: false,
  logLevel: 'error',
});

for (const asset of module.ASSETS) {
  const manifest = {
    scriptSha256: module.scriptSha256(asset, root),
    commonSha256: module.commonSha256(root),
    paramsSha256: module.paramsSha256(asset, root),
    blenderVersion,
    gltfTransformVersion: VERSION,
    glbSha256: module.glbSha256(asset, root),
    glbBytes: statSync(join(root, asset.glb)).size,
  };
  const file = join(root, asset.manifest);
  const config = await resolveConfig(file);
  writeFileSync(file, await format(JSON.stringify(manifest), { ...config, filepath: file }));
}
