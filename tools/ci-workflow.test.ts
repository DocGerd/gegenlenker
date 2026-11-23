import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { parse } from 'yaml';

// `webgpu` is advisory: it reports, but does not gate a merge. `release` tags after `deploy`.
const NOT_GATED = new Set(['check', 'build-pages', 'deploy', 'release', 'webgpu']);

type Permissions = Record<string, string> | string;

interface Workflow {
  permissions?: Permissions;
  jobs: Record<
    string,
    {
      needs?: string[] | string;
      if?: string;
      permissions?: Permissions;
      steps?: {
        name?: string;
        if?: string;
        uses?: string;
        run?: string;
        with?: Record<string, unknown>;
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

it('PRs into main run the head-branch guard and release:check, with the tags fetched first', () => {
  const steps = workflow().jobs['lint']?.steps ?? [];
  const guard = steps.findIndex((step) => step.run?.includes('release/* | hotfix/*') === true);
  const check = steps.findIndex((step) => step.run?.includes('pnpm release:check') === true);
  expect(guard).toBeGreaterThanOrEqual(0);
  expect(check).toBeGreaterThan(guard);
  for (const step of [steps[guard], steps[check]]) {
    expect(step?.if).toContain("github.base_ref == 'main'");
  }
  expect(steps[check]?.run?.indexOf('git fetch')).toBeLessThan(
    steps[check]?.run?.indexOf('pnpm release:check') ?? -1,
  );
  expect(steps[check]?.run).toContain("'refs/tags/*:refs/tags/*'");
});

it('only main deploys: develop pushes run the gate and nothing else', () => {
  const { jobs } = workflow();
  for (const name of ['build-pages', 'release']) {
    expect(jobs[name]?.if, name).toContain("github.ref == 'refs/heads/main'");
  }
  expect(jobs['deploy']?.needs).toBe('build-pages');
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
