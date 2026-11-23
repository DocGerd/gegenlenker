import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __BUILD__: JSON.stringify({ version: '0.0.0', release: false, commit: 'test' }) },
  test: {
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts', 'e2e/perf/**/*.test.ts'],
    environment: 'node',
    // Cap many-core hosts only; vitest's own default (run and watch) applies below that.
    ...(availableParallelism() > 9 ? { maxWorkers: 8 } : {}),
  },
});
