import console from 'node:console';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { runnerImport } from 'vite';

const root = join(import.meta.dirname, '..');

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { date: { type: 'string' } },
});
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const dirty = git('status', '--porcelain') !== '';
const tagged = git('tag', '--list', 'v*')
  .split('\n')
  .filter((tag) => tag !== '')
  .map((tag) => tag.slice(1));
const date = values.date ?? new Date().toISOString().slice(0, 10);

const { module } = await runnerImport('/tools/release.ts', {
  root,
  configFile: false,
  logLevel: 'error',
});

try {
  const result = module.prepareRelease(root, { version: positionals[0], date, dirty, tagged });
  console.log(
    result.changed
      ? `Prepared ${result.version}; folded ${String(result.folded.length)} fragment(s).`
      : `${result.version} is already prepared.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
