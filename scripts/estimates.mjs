import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runnerImport } from 'vite';

const START = '<!-- estimates:start -->';
const END = '<!-- estimates:end -->';
const root = join(import.meta.dirname, '..');
const readme = join(root, 'README.md');

const { module } = await runnerImport('/src/vehicles/estimates.ts', {
  root,
  configFile: false,
  logLevel: 'error',
});

const text = readFileSync(readme, 'utf8');
const [head, rest] = text.split(START);
const tail = rest?.split(END)[1];
if (tail === undefined) throw new Error('README has no estimates markers');
writeFileSync(readme, `${head}${START}\n${module.estimatesTable()}\n${END}${tail}`);
