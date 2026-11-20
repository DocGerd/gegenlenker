import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts', 'e2e/perf/**/*.test.ts'],
    environment: 'node',
    // Vitest's default is availableParallelism() - 1; cap it on many-core dev hosts.
    maxWorkers: Math.max(1, Math.min(8, availableParallelism() - 1)),
  },
});
