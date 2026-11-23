import console from 'node:console';
import process from 'node:process';
import { join } from 'node:path';
import { runnerImport } from 'vite';

const root = join(import.meta.dirname, '..');

const { module } = await runnerImport('/tools/release.ts', {
  root,
  configFile: false,
  logLevel: 'error',
});

const problems = module.checkRelease(root);
if (problems.length > 0) {
  console.error(`Not a release tree:\n- ${problems.join('\n- ')}`);
  process.exitCode = 1;
}
