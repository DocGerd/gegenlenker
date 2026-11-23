import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { parse } from 'yaml';

// `webgpu` is advisory: it reports, but does not gate a merge. `release` tags after `deploy`.
const NOT_GATED = new Set(['check', 'build-pages', 'deploy', 'release', 'webgpu']);

interface Workflow {
  permissions?: Record<string, string>;
  jobs: Record<
    string,
    { needs?: string[] | string; if?: string; permissions?: Record<string, string> }
  >;
}

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
  expect(permissions?.['contents']).toBe('read');
  const writers = Object.entries(jobs)
    .filter(([, job]) => job.permissions?.['contents'] === 'write')
    .map(([name]) => name);
  expect(writers).toEqual(['release']);
  expect(jobs['release']?.needs).toBe('deploy');
  expect(jobs['release']?.if).toContain("needs.deploy.result == 'success'");
  expect(jobs['release']?.if).toContain("github.ref == 'refs/heads/main'");
});
