import process from 'node:process';
import { resolve } from 'node:path';
import { runnerImport } from 'vite';

const root = resolve(import.meta.dirname, '..');
const dir = process.argv[2];
if (dir === undefined) throw new Error('usage: node scripts/prod-manifest.mjs <dist-dir>');

const { module } = await runnerImport('/tools/prod-manifest.ts', {
  root,
  configFile: false,
  logLevel: 'error',
});
process.stdout.write(module.prodManifest(resolve(dir)));
