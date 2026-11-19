// Usage: node scripts/glb-params.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { runnerImport } from 'vite';

const root = join(import.meta.dirname, '..');
const { module } = await runnerImport('/tools/blender/glb-build.ts', {
  root,
  configFile: false,
  logLevel: 'error',
});

for (const asset of module.RUNS) {
  const file = join(root, asset.params);
  mkdirSync(dirname(file), { recursive: true });
  const config = await resolveConfig(file);
  writeFileSync(file, await format(JSON.stringify(asset.build()), { ...config, filepath: file }));
}
