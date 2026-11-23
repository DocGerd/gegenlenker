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
// release:check checks HEAD and the tag goes to GITHUB_SHA, so they must be one commit.
const checkedOut = run('git', ['rev-parse', 'HEAD']).trim();
if (checkedOut !== sha) throw new Error(`HEAD is ${checkedOut}, not GITHUB_SHA ${sha}`);

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
const listed =
  version === null
    ? []
    : JSON.parse(run('gh', ['release', 'list', '--limit', '1000', '--json', 'tagName,isDraft']));

const plan = planPublish({ head: version, tagCommit, sha, releases: listed });
if (plan.action === 'fail') {
  console.error(`::error::${plan.message}`);
  process.exitCode = 1;
} else {
  console.log(`::notice::${plan.message}`);
  if (plan.action === 'create') {
    // No assets, so the release is created published in one request (no draft step). `--latest`
    // is explicit either way: without it the API makes every new release Latest.
    const args = ['release', 'create', tag, '--target', sha, '--title', tag, '--notes-file', '-'];
    run('gh', [...args, `--latest=${String(plan.latest)}`], {
      input: releaseNotes(root, version, false),
      stdio: ['pipe', 'inherit', 'inherit'],
    });
  }
}
