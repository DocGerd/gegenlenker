import console from 'node:console';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { runnerImport } from 'vite';

const root = join(import.meta.dirname, '..');

const tags = (...args) =>
  execFileSync('git', ['tag', '--list', 'v*', ...args], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((tag) => tag !== '');
const here = new Set(tags('--points-at', 'HEAD'));
const taggedElsewhere = tags()
  .filter((tag) => !here.has(tag))
  .map((tag) => tag.slice(1));

const { module } = await runnerImport('/tools/release.ts', {
  root,
  configFile: false,
  logLevel: 'error',
});

const problems = module.checkRelease(root, taggedElsewhere);
if (problems.length > 0) {
  console.error(`Not a release tree:\n- ${problems.join('\n- ')}`);
  process.exitCode = 1;
}
