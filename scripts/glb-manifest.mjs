// Usage: node scripts/glb-manifest.mjs "<Blender version string>"
// Writes the manifest of every asset from the files on disk. An asset whose glb is unchanged keeps
// the Blender version recorded for it, so only the rebuilt assets take the given one.
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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
  const file = join(root, asset.manifest);
  const glbSha256 = module.glbSha256(asset, root);
  const recorded = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  const unchanged = recorded?.glbSha256 === glbSha256;
  const manifest = {
    ...module.runHashes(asset, root),
    blenderVersion: unchanged ? recorded.blenderVersion : blenderVersion,
    gltfTransformVersion: VERSION,
    glbSha256,
    glbBytes: statSync(join(root, asset.glb)).size,
  };
  const config = await resolveConfig(file);
  writeFileSync(file, await format(JSON.stringify(manifest), { ...config, filepath: file }));
}
