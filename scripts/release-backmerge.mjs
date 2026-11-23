import console from 'node:console';
import process from 'node:process';
import { join } from 'node:path';
import { runnerImport } from 'vite';

const root = join(import.meta.dirname, '..');

const { module } = await runnerImport('/tools/release-flow.ts', {
  root,
  configFile: false,
  logLevel: 'error',
});

process.exitCode = module.runCli('release-backmerge', process.argv.slice(2), root, console);
