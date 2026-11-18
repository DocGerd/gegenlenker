import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { estimatesTable } from './estimates';

it('vehicle-data doc lists every estimated parameter', () => {
  const doc = readFileSync(new URL('../../docs/vehicle-data.md', import.meta.url), 'utf8');
  const section = doc
    .split('<!-- estimates:start -->')[1]
    ?.split('<!-- estimates:end -->')[0]
    ?.trim();
  expect(section).toBe(estimatesTable().trim());
});
