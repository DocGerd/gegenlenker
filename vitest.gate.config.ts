import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';

// The Einweiser gate (`docs/einweiser-spike.md` §9): one file per exercise over `gate-harness.ts`.
// Not part of `pnpm test`; the advisory `einweiser-gate` CI job runs it.
export default defineConfig({
  define: { __BUILD__: JSON.stringify({ version: '0.0.0', release: false, commit: 'test' }) },
  test: {
    include: ['src/einweiser/gate-!(recovery).test.ts'],
    environment: 'node',
    ...(availableParallelism() > 9 ? { maxWorkers: 8 } : {}),
  },
});
