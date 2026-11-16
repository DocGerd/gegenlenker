import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { estimatesTable } from './estimates';

it('README lists every estimated parameter', () => {
  const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
  const section = readme
    .split('<!-- estimates:start -->')[1]
    ?.split('<!-- estimates:end -->')[0]
    ?.trim();
  expect(section).toBe(estimatesTable().trim());
});
