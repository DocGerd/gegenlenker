import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { parse } from 'yaml';

const NOT_GATED = new Set(['check', 'build-pages', 'deploy']);

it('check needs every job except the check itself and the deploy chain', () => {
  const file = join(import.meta.dirname, '..', '.github', 'workflows', 'ci.yml');
  const jobs = (parse(readFileSync(file, 'utf8')) as { jobs: Record<string, { needs?: string[] }> })
    .jobs;
  const expected = Object.keys(jobs)
    .filter((name) => !NOT_GATED.has(name))
    .sort();
  expect(expected.length).toBeGreaterThan(0);
  expect([...(jobs['check']?.needs ?? [])].sort()).toEqual(expected);
});
