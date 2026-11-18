// Usage: node scripts/cab-manifest.mjs "<Blender version string>"
import { statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { argv } from 'node:process';
import { VERSION } from '@gltf-transform/core';
import { format, resolveConfig } from 'prettier';
import { runnerImport } from 'vite';

const blenderVersion = argv[2];
if (blenderVersion === undefined) throw new Error('usage: cab-manifest.mjs "<Blender version>"');

const root = join(import.meta.dirname, '..');
const { module } = await runnerImport('/tools/blender/cab-build.ts', {
  root,
  configFile: false,
  logLevel: 'error',
});

const manifest = {
  scriptSha256: module.scriptSha256(root),
  paramsSha256: module.paramsSha256(root),
  blenderVersion,
  gltfTransformVersion: VERSION,
  glbSha256: module.glbSha256(root),
  glbBytes: statSync(join(root, module.CAB_FILES.glb)).size,
};

const file = join(root, module.CAB_FILES.manifest);
const config = await resolveConfig(file);
writeFileSync(file, await format(JSON.stringify(manifest), { ...config, filepath: file }));
