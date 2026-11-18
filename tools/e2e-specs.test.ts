import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { OFFLINE_SPECS } from '../e2e/offline-specs';

it('every e2e spec is registered in the offline project', () => {
  const specs = readdirSync(join(import.meta.dirname, '..', 'e2e')).filter((f) =>
    f.endsWith('.spec.ts'),
  );
  expect(specs.length).toBeGreaterThan(0);
  expect(specs.filter((f) => !OFFLINE_SPECS.test(f))).toEqual([]);
});
