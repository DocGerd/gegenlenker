import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { runnerImport } from 'vite';

const TRUCKS = ['man-le-18-280'];
const root = join(import.meta.dirname, '..');
const options = { root, configFile: false, logLevel: 'error' };

const { module: dims } = await runnerImport('/src/render/cab-dims.ts', options);
const { module: registry } = await runnerImport('/src/vehicles/registry.ts', options);

const dir = join(root, 'tools/blender/params');
mkdirSync(dir, { recursive: true });
for (const id of TRUCKS) {
  const file = join(dir, `${id}.cab.json`);
  const json = JSON.stringify(dims.cabShellParams(registry.truckById(id)));
  const config = await resolveConfig(file);
  writeFileSync(file, await format(json, { ...config, filepath: file }));
}
