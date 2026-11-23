import console from 'node:console';
import process from 'node:process';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { runnerImport } from 'vite';

const root = join(import.meta.dirname, '..');
const run = (cmd, args, options = {}) =>
  execFileSync(cmd, args, { cwd: root, encoding: 'utf8', ...options });

const sha = process.env['GITHUB_SHA'];
if (sha === undefined || sha === '') throw new Error('GITHUB_SHA is not set');

const loaded = (path) =>
  runnerImport(path, { root, configFile: false, logLevel: 'error' }).then(({ module }) => module);
const { loadReleases } = await loaded('/tools/changelog.ts');
const { releaseNotes } = await loaded('/tools/release.ts');
const { planPublish } = await loaded('/tools/release-publish.ts');

const releases = loadReleases(join(root, 'changelog.d'));
if (!Array.isArray(releases)) throw new Error('changelog.d/released.json is not a list');
const version = releases[0]?.version ?? null;

// A tree with a released head must pass the full release check, whatever else it looks like.
if (version !== null) {
  const check = spawnSync(process.execPath, ['scripts/release-check.mjs'], {
    cwd: root,
    stdio: 'inherit',
  });
  if (check.status !== 0) process.exit(1);
}

const tag = `v${version}`;
const tagged = version !== null && run('git', ['tag', '--list', tag]).trim() !== '';
const tagCommit = !tagged ? null : run('git', ['rev-parse', `${tag}^{commit}`]).trim();
let release = 'none';
if (version !== null) {
  const listed = JSON.parse(
    run('gh', ['release', 'list', '--limit', '1000', '--json', 'tagName,isDraft']),
  );
  const found = listed.find((item) => item.tagName === tag);
  if (found !== undefined) release = found.isDraft ? 'draft' : 'published';
}

const plan = planPublish({ head: version, tagCommit, sha, release });
if (plan.action === 'fail') {
  console.error(`::error::${plan.message}`);
  process.exitCode = 1;
} else {
  console.log(`::notice::${plan.message}`);
  if (plan.action === 'create') {
    // No assets, so the release is created published in one request (no draft step).
    run(
      'gh',
      ['release', 'create', tag, '--target', sha, '--title', tag, '--notes-file', '-', '--latest'],
      { input: releaseNotes(root, version, false), stdio: ['pipe', 'inherit', 'inherit'] },
    );
  }
}
