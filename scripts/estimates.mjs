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
const once = (marker) => {
  const at = text.indexOf(marker);
  if (at === -1 || text.indexOf(marker, at + 1) !== -1) {
    throw new Error(`docs/vehicle-data.md must contain ${marker} exactly once`);
  }
  return at;
};
const start = once(START);
const end = once(END);
if (end < start)
  throw new Error('docs/vehicle-data.md has its estimates markers in the wrong order');
writeFileSync(
  doc,
  `${text.slice(0, start)}${START}\n${module.estimatesTable()}\n${text.slice(end)}`,
);
