import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runnerImport } from 'vite';

const START = '<!-- credits:start -->';
const END = '<!-- credits:end -->';
const root = join(import.meta.dirname, '..');
const doc = join(root, 'docs', 'asset-credits.md');

const { module } = await runnerImport('/tools/assets/sources.ts', {
  root,
  configFile: false,
  logLevel: 'error',
});

const text = readFileSync(doc, 'utf8');
const once = (marker) => {
  const at = text.indexOf(marker);
  if (at === -1 || text.indexOf(marker, at + 1) !== -1) {
    throw new Error(`docs/asset-credits.md must contain ${marker} exactly once`);
  }
  return at;
};
const start = once(START);
const end = once(END);
if (end < start)
  throw new Error('docs/asset-credits.md has its credits markers in the wrong order');
writeFileSync(
  doc,
  `${text.slice(0, start)}${START}${module.creditsSection(module.ASSET_SOURCES)}${text.slice(end)}`,
);
