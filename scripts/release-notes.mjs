import console from 'node:console';
import process from 'node:process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { runnerImport } from 'vite';

const root = join(import.meta.dirname, '..');

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { body: { type: 'boolean', default: false } },
});

const { module } = await runnerImport('/tools/release.ts', {
  root,
  configFile: false,
  logLevel: 'error',
});

try {
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  console.log(module.releaseNotes(root, positionals[0] ?? version, !values.body));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
