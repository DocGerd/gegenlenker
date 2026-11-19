import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts', 'e2e/perf/**/*.test.ts'],
    environment: 'node',
  },
});
