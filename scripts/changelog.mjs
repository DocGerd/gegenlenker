import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runnerImport } from 'vite';

const root = join(import.meta.dirname, '..');

const { module } = await runnerImport('/tools/changelog.ts', {
  root,
  configFile: false,
  logLevel: 'error',
});

writeFileSync(join(root, 'CHANGELOG.md'), module.generateChangelog(root));
