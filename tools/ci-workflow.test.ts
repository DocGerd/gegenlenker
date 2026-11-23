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
      steps?: { uses?: string; run?: string; with?: Record<string, unknown> }[];
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
