import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { parse } from 'yaml';

// `webgpu` is advisory: it reports, but does not gate a merge.
const NOT_GATED = new Set(['check', 'build-pages', 'deploy', 'webgpu']);

it('check needs every job except the check itself, the advisory job and the deploy chain', () => {
  const file = join(import.meta.dirname, '..', '.github', 'workflows', 'ci.yml');
  const jobs = (
    parse(readFileSync(file, 'utf8')) as {
      jobs: Record<string, { needs?: string[]; if?: string }>;
    }
  ).jobs;
  const expected = Object.keys(jobs)
    .filter((name) => !NOT_GATED.has(name))
    .sort();
  expect(expected.length).toBeGreaterThan(0);
  expect([...(jobs['check']?.needs ?? [])].sort()).toEqual(expected);
});

// `check` accepts only a skipped e2e on push: any other gated job that skips there fails it.
it('every gated job but e2e runs on push', () => {
  const file = join(import.meta.dirname, '..', '.github', 'workflows', 'ci.yml');
  const jobs = (parse(readFileSync(file, 'utf8')) as { jobs: Record<string, { if?: string }> })
    .jobs;
  for (const [name, job] of Object.entries(jobs)) {
    if (NOT_GATED.has(name) || name === 'e2e') continue;
    expect(job.if, name).toBeUndefined();
  }
});
