import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// `webgpu` is advisory: it reports, but does not gate a merge. `release` tags after `deploy`. The
// deploy chains wait for the owner's approval, so a gate on them would hold every merge.
const NOT_GATED = new Set([
  'check',
  'build-pages',
  'deploy',
  'release',
  'build-uat',
  'deploy-uat',
  'webgpu',
]);

type Permissions = Record<string, string> | string;

interface Workflow {
  permissions?: Permissions;
  jobs: Record<
    string,
    {
      needs?: string[] | string;
      if?: string;
      permissions?: Permissions;
      concurrency?: Record<string, unknown>;
      environment?: { name?: string; url?: string };
      steps?: {
        name?: string;
        id?: string;
        if?: string;
        uses?: string;
        run?: string;
        with?: Record<string, unknown>;
        env?: Record<string, string>;
      }[];
    }
  >;
}

const writesContents = (permissions?: Permissions): boolean =>
  permissions === 'write-all' ||
  (typeof permissions === 'object' && permissions['contents'] === 'write');

const workflow = (): Workflow =>
  parse(
    readFileSync(join(import.meta.dirname, '..', '.github', 'workflows', 'ci.yml'), 'utf8'),
  ) as Workflow;

it('check needs every job except the check itself, the advisory job and the deploy chain', () => {
  const jobs = workflow().jobs;
  const expected = Object.keys(jobs)
    .filter((name) => !NOT_GATED.has(name))
    .sort();
  expect(expected.length).toBeGreaterThan(0);
  const needs = jobs['check']?.needs;
  expect([...(Array.isArray(needs) ? needs : [])].sort()).toEqual(expected);
});

it('only the release job can write contents, and only after a successful deploy on main', () => {
  const { jobs, permissions } = workflow();
  expect(permissions).toMatchObject({ contents: 'read' });
  const writers = Object.entries(jobs)
    .filter(([, job]) => writesContents(job.permissions))
    .map(([name]) => name);
  expect(writers).toEqual(['release']);
  expect(jobs['release']?.needs).toBe('deploy');
  expect(jobs['release']?.if).toContain("needs.deploy.result == 'success'");
  expect(jobs['release']?.if).toContain("github.ref == 'refs/heads/main'");
});

it('the release job fetches every tag, since its tag checks read the local clone', () => {
  const checkout = workflow().jobs['release']?.steps?.find((step) =>
    step.uses?.startsWith('actions/checkout@'),
  );
  expect(checkout?.with?.['fetch-depth']).toBe(0);
});

// `check` accepts only a skipped e2e on push: any other gated job that skips there fails it.
it('every gated job but e2e runs on push', () => {
  const jobs = workflow().jobs;
  for (const [name, job] of Object.entries(jobs)) {
    if (NOT_GATED.has(name) || name === 'e2e') continue;
    expect(job.if, name).toBeUndefined();
  }
});

const REPO = 'DocGerd/gegenlenker';
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};
const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8', stdio: 'pipe' });

/** A lint step that runs only on PRs into main, by its script. */
const mainPrStep = (name: string): string => {
  const step = workflow().jobs['lint']?.steps?.find((each) => each.name === name);
  expect(step?.if, name).toBe("github.event_name == 'pull_request' && github.base_ref == 'main'");
  return step?.run ?? '';
};

/** Runs a step script as the runner's default shell does (`bash -e {0}`). */
const runStep = (script: string, cwd: string, env: NodeJS.ProcessEnv): number | null =>
  spawnSync('bash', ['-e', '-c', script], { cwd, env, stdio: 'pipe' }).status;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it('the PR-into-main guard admits only release and hotfix heads of this repository', () => {
  const guard = mainPrStep('Only release and hotfix branches open PRs into main');
  const cases: [string, string, number][] = [
    ['release/1.0.0', REPO, 0],
    ['hotfix/1.0.1', REPO, 0],
    ['feature/x', REPO, 1],
    ['develop', REPO, 1],
    ['releases/1.0.0', REPO, 1],
    ['release', REPO, 1],
    ['release/1.0.0', 'someone/gegenlenker', 1],
    ['release/1.0.0', '', 1],
  ];
  for (const [ref, repo, status] of cases) {
    const env = { ...process.env, HEAD_REF: ref, HEAD_REPO: repo, GITHUB_REPOSITORY: REPO };
    expect(runStep(guard, tmpdir(), env), `${repo} ${ref}`).toBe(status);
  }
});

describe('the release-tree step on a PR into main', () => {
  // A depth-1 clone like the checkout's; the `pnpm` stub records the tags `release:check` sees.
  const clone = (tagged: boolean): { cwd: string; env: NodeJS.ProcessEnv; seen: string } => {
    const dir = mkdtempSync(join(tmpdir(), 'ci-tags-'));
    dirs.push(dir);
    const origin = join(dir, 'origin');
    mkdirSync(origin);
    git(origin, 'init', '-q', '-b', 'main');
    git(origin, 'commit', '-q', '--allow-empty', '-m', 'released');
    if (tagged) git(origin, 'tag', 'v1.0.0');
    git(origin, 'commit', '-q', '--allow-empty', '-m', 'head');
    git(dir, 'clone', '-q', '--depth=1', `file://${origin}`, 'clone');
    const bin = join(dir, 'bin');
    const seen = join(dir, 'seen');
    mkdirSync(bin);
    writeFileSync(join(bin, 'pnpm'), `#!/bin/sh\ngit tag --list 'v*' > '${seen}'\n`, {
      mode: 0o755,
    });
    const env = { ...GIT_ENV, PATH: `${bin}:${process.env['PATH'] ?? ''}` };
    return { cwd: join(dir, 'clone'), env, seen };
  };
  const step = (): string => mainPrStep('Check the release tree');

  it('passes the remote tags to release:check, including a tag off the shallow history', () => {
    const { cwd, env, seen } = clone(true);
    expect(runStep(step(), cwd, env)).toBe(0);
    expect(readFileSync(seen, 'utf8')).toBe('v1.0.0\n');
  });

  it('runs release:check before the first tag exists', () => {
    const { cwd, env, seen } = clone(false);
    expect(runStep(step(), cwd, env)).toBe(0);
    expect(readFileSync(seen, 'utf8')).toBe('');
  });

  it('fails without running release:check when the tags cannot be listed', () => {
    const { cwd, env, seen } = clone(true);
    git(cwd, 'remote', 'set-url', 'origin', `file://${join(cwd, 'missing')}`);
    expect(runStep(step(), cwd, env)).not.toBe(0);
    expect(existsSync(seen)).toBe(false);
  });
});

it('main deploys production and develop deploys UAT, each after a green check', () => {
  const { jobs } = workflow();
  expect(jobs['build-pages']?.if).toBe(
    "!cancelled() && needs.check.result == 'success' && " +
      "(github.event_name == 'push' || github.event_name == 'workflow_dispatch') && " +
      "github.ref == 'refs/heads/main'",
  );
  expect(jobs['deploy']?.needs).toBe('build-pages');
  expect(jobs['deploy']?.if).toBe("${{ !cancelled() && needs.build-pages.result == 'success' }}");
  expect(jobs['release']?.if).toBe(
    "${{ !cancelled() && needs.deploy.result == 'success' && github.ref == 'refs/heads/main' }}",
  );
  expect(jobs['build-uat']?.needs).toBe('check');
  expect(jobs['build-uat']?.if).toBe(
    "!cancelled() && needs.check.result == 'success' && " +
      "(github.event_name == 'push' || github.event_name == 'workflow_dispatch') && " +
      "github.ref == 'refs/heads/develop'",
  );
  expect(jobs['deploy-uat']?.needs).toBe('build-uat');
  expect(jobs['deploy-uat']?.if).toBe("${{ !cancelled() && needs.build-uat.result == 'success' }}");
});

// Approval-gated: a `check` that needed them would wait for the owner on every develop push.
it('check needs neither UAT job', () => {
  const needs = workflow().jobs['check']?.needs;
  expect(Array.isArray(needs) ? needs : [needs]).not.toContain('build-uat');
  expect(Array.isArray(needs) ? needs : [needs]).not.toContain('deploy-uat');
});

// Whether a job waiting for approval holds its group is undocumented. One group serialises every
// deploy either way, and `queue: max` keeps a waiting deploy from being replaced by a newer one.
it('both deploy jobs share one pages group that queues instead of replacing', () => {
  const { jobs } = workflow();
  const inPages = Object.entries(jobs)
    .filter(([, job]) => job.concurrency?.['group'] === 'pages')
    .map(([name]) => name);
  expect(inPages.sort()).toEqual(['deploy', 'deploy-uat']);
  for (const name of inPages) {
    expect(jobs[name]?.concurrency, name).toEqual({
      group: 'pages',
      'cancel-in-progress': false,
      queue: 'max',
    });
    expect(jobs[name]?.environment?.name, name).toBe('github-pages');
  }
});

it('the UAT deploy assembles production in its group-held job, right before uploading', () => {
  const job = workflow().jobs['deploy-uat'];
  const steps = job?.steps ?? [];
  const assemble = steps.findIndex((step) => step.name === 'Assemble production and UAT');
  expect(steps[assemble]?.run).toBe('node tools/uat-pages.ts "$RUNNER_TEMP/pages"');
  expect(steps[assemble]?.env?.['GH_TOKEN']).toBe('${{ github.token }}');
  expect(steps[assemble + 1]?.uses).toMatch(/^actions\/upload-pages-artifact@/);
  expect(steps[assemble + 1]?.with?.['path']).toBe('${{ runner.temp }}/pages/dist');
  expect(steps[assemble + 2]?.uses).toMatch(/^actions\/deploy-pages@/);
  expect(steps.slice(assemble + 3)).toEqual([]);
  // Plain Node: nothing installs packages in this job.
  expect(steps.some((step) => step.run?.includes('pnpm') === true)).toBe(false);
  expect(job?.permissions).toMatchObject({ actions: 'read', pages: 'write', 'id-token': 'write' });
});

it('the UAT build uses the UAT channel and base, and preflights the production dist', () => {
  const steps = workflow().jobs['build-uat']?.steps ?? [];
  const build = steps.findIndex((step) => step.run === 'pnpm build --outDir dist/uat');
  const upload = steps.findIndex((step) => step.with?.['name'] === 'uat-dist-${{ github.sha }}');
  const preflight = steps.findIndex((step) => step.name === 'Preflight the production dist');
  expect(steps[build]?.env).toEqual({ BASE_PATH: '/gegenlenker/uat/', DEPLOY_CHANNEL: 'uat' });
  expect(steps.filter((step) => step.run?.includes('pnpm build') === true)).toHaveLength(1);
  expect(upload).toBeGreaterThan(build);
  expect(steps[upload]?.with?.['path']).toBe('dist/uat');
  expect(steps[preflight]?.run).toBe(
    'node tools/uat-pages.ts "$RUNNER_TEMP/preflight" --prod-only',
  );
});

it('every action is pinned to a full commit SHA', () => {
  for (const [name, job] of Object.entries(workflow().jobs)) {
    for (const step of job.steps ?? []) {
      if (step.uses !== undefined) expect(step.uses, name).toMatch(/@[0-9a-f]{40}$/);
    }
  }
});

// The `develop` deploy consumes this dist; production is never rebuilt for it.
it('build-pages proves a second build identical, then uploads dist with its manifest', () => {
  const job = workflow().jobs['build-pages'];
  const steps = job?.steps ?? [];
  const index = (match: (step: (typeof steps)[number]) => boolean): number =>
    steps.findIndex(match);
  const build = index((step) => step.run === 'pnpm build');
  const again = index((step) => step.run?.includes('diff -r dist') === true);
  const manifest = index((step) => step.run?.includes('scripts/prod-manifest.mjs') === true);
  const upload = index((step) => step.with?.['name'] === 'prod-dist-${{ github.sha }}');
  const pages = index((step) => step.uses?.startsWith('actions/upload-pages-artifact@') === true);
  expect(build).toBeGreaterThanOrEqual(0);
  expect(again).toBeGreaterThan(build);
  expect(manifest).toBeGreaterThan(again);
  expect(upload).toBeGreaterThan(manifest);
  expect(pages).toBeGreaterThan(upload);
  expect(steps[again]?.run).toContain('pnpm build --outDir');
  expect(steps[upload]?.uses).toMatch(/^actions\/upload-artifact@/);
  expect(steps[upload]?.with?.['path']).toMatch(/^dist\nprod-manifest\.txt\nprod-commit\.txt\n?$/);
  expect(steps[upload]?.with?.['retention-days']).toBe(90);
  expect(steps[pages]?.with?.['path']).toBe('dist');
  expect(job?.permissions).toBeUndefined();
});

it('a gated job checks the production dist the same way before the merge', () => {
  const { jobs } = workflow();
  const steps = jobs['channels']?.steps ?? [];
  const check = steps.findIndex((step) => step.run?.includes('diff -r dist') === true);
  const uat = steps.findIndex((step) => step.run === 'pnpm build --outDir dist/uat');
  const manifest = (jobs['build-pages']?.steps ?? [])
    .find((step) => step.run?.includes('scripts/prod-manifest.mjs') === true)
    ?.run?.split('\n')
    .filter((line) => line.includes('prod-manifest'));
  expect(check).toBeGreaterThanOrEqual(0);
  expect(manifest?.some((line) => line.includes('sha256sum --check --quiet --strict'))).toBe(true);
  for (const line of manifest ?? []) expect(steps[check]?.run).toContain(line);
  expect(uat).toBeGreaterThan(check);
});
