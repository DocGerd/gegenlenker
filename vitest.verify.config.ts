import { defineConfig } from 'vitest/config';

// Bounded exhaustive layout verification (`pnpm verify:layout`); not part of `pnpm test`.
export default defineConfig({
  define: { __BUILD__: JSON.stringify({ version: '0.0.0', release: false, commit: 'test' }) },
  test: {
    include: ['src/render/viewports.verify.ts'],
    environment: 'node',
    fileParallelism: false,
    disableConsoleIntercept: true,
    maxWorkers: 1,
    testTimeout: 0,
    hookTimeout: 0,
  },
});
