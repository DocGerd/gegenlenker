import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runnerImport } from 'vite';

const START = '<!-- estimates:start -->';
const END = '<!-- estimates:end -->';
const root = join(import.meta.dirname, '..');
const doc = join(root, 'docs', 'vehicle-data.md');

const { module } = await runnerImport('/src/vehicles/estimates.ts', {
  root,
  configFile: false,
  logLevel: 'error',
});

const text = readFileSync(doc, 'utf8');
const [head, rest] = text.split(START);
const tail = rest?.split(END)[1];
if (tail === undefined) throw new Error('docs/vehicle-data.md has no estimates markers');
writeFileSync(doc, `${head}${START}\n${module.estimatesTable()}\n${END}${tail}`);
