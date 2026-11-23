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
      steps?: { uses?: string; with?: Record<string, unknown> }[];
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
