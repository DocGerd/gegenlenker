import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// `webgpu` is advisory: it reports, but does not gate a merge. `release` tags after `deploy`, and
// the deploy chains run only after a push, so a gate on them would hold every merge.
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
  concurrency?: Record<string, unknown>;
  jobs: Record<
    string,
    {
      needs?: string[] | string;
      if?: string;
      permissions?: Permissions;
      concurrency?: Record<string, unknown>;
      environment?: { name?: string; url?: string };
      outputs?: Record<string, string>;
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

// `check` accepts only a skipped e2e, and only on a push to `main`: any other gated job that skips fails it.
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

const DEVELOP_ONLY =
  "!cancelled() && needs.lint.result == 'success' && needs.unit.result == 'success' && " +
  "needs.channels.result == 'success' && " +
  "(github.event_name == 'push' || github.event_name == 'workflow_dispatch') && " +
  "github.ref == 'refs/heads/develop'";

it('main deploys production after a green check and develop deploys UAT after the fast jobs', () => {
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
  expect(jobs['build-uat']?.needs).toEqual(['lint', 'unit', 'channels']);
  expect(jobs['build-uat']?.if).toBe(DEVELOP_ONLY);
  expect(jobs['deploy-uat']?.needs).toBe('build-uat');
  expect(jobs['deploy-uat']?.if).toBe("${{ !cancelled() && needs.build-uat.result == 'success' }}");
});

// Cancelling a running `develop` run would let a burst of merges starve its e2e.
it('only PR runs cancel an earlier run', () => {
  expect(workflow().concurrency?.['cancel-in-progress']).toBe(
    "${{ github.event_name == 'pull_request' }}",
  );
});

// One group serialises every deploy, and `queue: max` keeps a waiting deploy from being replaced
// by a newer one.
it('every deploy job shares one pages group that queues instead of replacing', () => {
  const { jobs } = workflow();
  const inPages = Object.entries(jobs)
    .filter(([, job]) => job.concurrency?.['group'] === 'pages')
    .map(([name]) => name);
  expect(inPages.sort()).toEqual(['deploy', 'deploy-uat']);
  for (const name of inPages)
    expect(jobs[name]?.concurrency, name).toEqual({
      group: 'pages',
      'cancel-in-progress': false,
      queue: 'max',
    });
});

it('production deploys to github-pages and UAT to uat-pages', () => {
  const { jobs } = workflow();
  expect(jobs['deploy']?.environment?.name).toBe('github-pages');
  expect(jobs['deploy-uat']?.environment?.name).toBe('uat-pages');
});

// Only a release changes `main`: a `develop` change to the script must not reach the code that
// verifies and publishes the site root.
it('the jobs that read deployments or publish run main code only, without packages', () => {
  const { jobs } = workflow();
  const privileged = Object.entries(jobs)
    .filter(([, job]) => {
      const permissions = typeof job.permissions === 'object' ? job.permissions : {};
      return (
        permissions['pages'] === 'write' ||
        permissions['id-token'] === 'write' ||
        permissions['deployments'] !== undefined
      );
    })
    .map(([name]) => name);
  expect(privileged.sort()).toEqual(['deploy', 'deploy-uat']);
  for (const name of ['deploy-uat']) {
    const steps = jobs[name]?.steps ?? [];
    const checkouts = steps.filter((step) => step.uses?.startsWith('actions/checkout@') === true);
    expect(checkouts, name).toHaveLength(1);
    expect(checkouts[0]?.with, name).toEqual({
      ref: 'refs/heads/main',
      'persist-credentials': false,
    });
    expect(steps.indexOf(checkouts[0] ?? {}), name).toBe(0);
    expect(
      steps.filter(
        (step) => step.uses?.startsWith('./') === true || step.uses?.includes('pnpm') === true,
      ),
      name,
    ).toEqual([]);
    for (const step of steps)
      expect(step.run ?? '', name).not.toMatch(/\bpnpm\b|download-artifact/);
  }
  // The develop checkout builds with the workflow's read-only token and nothing else.
  expect(jobs['build-uat']?.permissions).toBeUndefined();
});

describe('the UAT pages step', () => {
  const step = (job: string): string => {
    const steps = workflow().jobs[job]?.steps ?? [];
    const found = steps.find((each) => each.run?.includes('tools/uat-pages.ts') === true);
    expect(found?.env, job).toEqual({ GH_TOKEN: '${{ github.token }}' });
    return found?.run ?? '';
  };
  const checkout = (script: boolean): { cwd: string; env: NodeJS.ProcessEnv; seen: string } => {
    const cwd = mkdtempSync(join(tmpdir(), 'ci-uat-'));
    dirs.push(cwd);
    const seen = join(cwd, 'seen.json');
    if (script) {
      mkdirSync(join(cwd, 'tools'));
      writeFileSync(join(cwd, 'package.json'), '{"type":"module"}');
      writeFileSync(
        join(cwd, 'tools', 'uat-pages.ts'),
        "import { writeFileSync } from 'node:fs';\n" +
          `writeFileSync(${JSON.stringify(seen)}, JSON.stringify(process.argv.slice(2)));\n`,
      );
    }
    return { cwd, env: { ...process.env, RUNNER_TEMP: '/runner/temp' }, seen };
  };

  it('fails with a clear error while main lacks the script, never running another copy', () => {
    const { cwd, env, seen } = checkout(false);
    const result = spawnSync('bash', ['-e', '-c', step('deploy-uat')], {
      cwd,
      env,
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('::error::main has no tools/uat-pages.ts');
    expect(existsSync(seen)).toBe(false);
  });

  it('runs the script from main and assembles the whole tree', () => {
    const { cwd, env, seen } = checkout(true);
    expect(runStep(step('deploy-uat'), cwd, env)).toBe(0);
    expect(JSON.parse(readFileSync(seen, 'utf8'))).toEqual(['/runner/temp/pages']);
  });
});

it('a UAT deploy uploads the assembled tree right after assembling it, then deploys', () => {
  const steps = workflow().jobs['deploy-uat']?.steps ?? [];
  const assemble = steps.findIndex((step) => step.name === 'Assemble production and UAT');
  expect(steps[assemble + 1]?.uses).toMatch(/^actions\/upload-pages-artifact@/);
  expect(steps[assemble + 1]?.with?.['path']).toBe('${{ runner.temp }}/pages/dist');
  expect(steps[assemble + 2]?.uses).toMatch(/^actions\/deploy-pages@/);
  expect(steps.slice(assemble + 3)).toEqual([]);
});

it('the UAT build uses the UAT channel and base, and uploads it for the deploy', () => {
  const steps = workflow().jobs['build-uat']?.steps ?? [];
  const build = steps.findIndex((step) => step.run === 'pnpm build --outDir dist/uat');
  const upload = steps.findIndex((step) => step.with?.['name'] === 'uat-dist-${{ github.sha }}');
  expect(steps[build]?.env).toEqual({ BASE_PATH: '/gegenlenker/uat/', DEPLOY_CHANNEL: 'uat' });
  expect(steps.filter((step) => step.run?.includes('pnpm build') === true)).toHaveLength(1);
  expect(upload).toBeGreaterThan(build);
  expect(steps[upload]?.with?.['path']).toBe('dist/uat');
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
